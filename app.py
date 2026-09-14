import logging
logging.getLogger('httpx').setLevel(logging.WARNING)
import os
import platform

# Fix SQLite "unable to open database file" over Windows Docker mount
dagster_home_dir = "/tmp/dagster_home" if platform.system() != 'Windows' else os.path.abspath(os.path.join(os.path.dirname(__file__), "dagster_home"))
os.environ['DAGSTER_HOME'] = dagster_home_dir
os.makedirs(dagster_home_dir, exist_ok=True)
dagster_yaml_path = os.path.join(dagster_home_dir, "dagster.yaml")
if not os.path.exists(dagster_yaml_path):
    try:
        with open(dagster_yaml_path, "w") as f:
            f.write("")
    except Exception:
        pass

import io
import json
import queue
import threading
import asyncio
import uuid
from datetime import datetime
import pandas as pd
from flask import Flask, render_template, request, Response, jsonify

from agents import OrchestratorAgent
from dagster import DagsterInstance, reconstructable
import dagster_pipeline
from utils.job_progress_store import get_progress
from utils.phase2_queue import queue_manager
from utils.geojson_cache import preload_all, get_geojson, get_available_countries

import logging
class NoJobsFilter(logging.Filter):
    def filter(self, record):
        return '/api/jobs HTTP' not in record.getMessage()

logging.getLogger('werkzeug').addFilter(NoJobsFilter())

app = Flask(__name__)
app.secret_key = os.urandom(24)
app.config.update(
    SESSION_COOKIE_SECURE=True,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax'
)

csp = {
    'default-src': ["'self'"],
    'script-src': [
        "'self'", "'unsafe-inline'", "'unsafe-eval'", 
        'https://cdn.tailwindcss.com', 'https://cdnjs.cloudflare.com', 
        'https://unpkg.com', 'https://cdn.jsdelivr.net'
    ],
    'style-src': [
        "'self'", "'unsafe-inline'", 
        'https://fonts.googleapis.com', 'https://unpkg.com', 'https://cdn.jsdelivr.net'
    ],
    'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
    'img-src': ["'self'", 'data:', 'https:', 'blob:'],
    'connect-src': ["'self'", 'https:']
}

# In local development, we shouldn't force HTTPS or we will break http://127.0.0.1:5000
# We check if FLASK_ENV is development or if running locally
is_dev = os.environ.get('FLASK_ENV') == 'development' or os.environ.get('DAGSTER_HOME') is not None
from flask_talisman import Talisman
talisman = Talisman(
    app,
    content_security_policy=csp,
    force_https=not is_dev,
    strict_transport_security=not is_dev,
    session_cookie_secure=True,
    session_cookie_http_only=True,
    session_cookie_samesite='Lax'
)

import time
import re
from collections import defaultdict
from flask import jsonify, request, g

# ── Security: Generic Error Handler ──────────────────────────────────────────
@app.errorhandler(500)
def internal_server_error(e):
    logging.getLogger(__name__).error(f"Internal Server Error: {e}")
    return jsonify({"error": "Internal server error occurred."}), 500

# ── Security: Security Headers & CORS ────────────────────────────────────────


# ── Security: Lightweight Rate Limiter ───────────────────────────────────────
_rate_limits = defaultdict(list)

def rate_limit(limit=10, window=60):
    def decorator(f):
        def wrapped(*args, **kwargs):
            ip = request.headers.get("X-Forwarded-For", request.remote_addr or "unknown").split(",")[0].strip()
            now = time.time()
            _rate_limits[ip] = [ts for ts in _rate_limits[ip] if now - ts < window]
            if len(_rate_limits[ip]) >= limit:
                return jsonify({"error": "Rate limit exceeded. Try again later."}), 429
            _rate_limits[ip].append(now)
            return f(*args, **kwargs)
        wrapped.__name__ = f.__name__
        return wrapped
    return decorator

# ── Security: Input Sanitization ─────────────────────────────────────────────
def sanitize_payload(payload):
    """Recursively strip HTML and script tags from string inputs."""
    if isinstance(payload, dict):
        return {k: sanitize_payload(v) for k, v in payload.items()}
    elif isinstance(payload, list):
        return [sanitize_payload(v) for v in payload]
    elif isinstance(payload, str):
        # Strip simple tags
        clean = re.sub(r'<[^>]+>', '', payload)
        # Prevent javascript: URIs
        clean = re.sub(r'javascript:', '', clean, flags=re.IGNORECASE)
        return clean.strip()
    return payload

# ── Payload compression (Gzip / Brotli) ────────────────────────────────────
try:
    from flask_compress import Compress

    _compress = Compress()
    _compress.init_app(app)
    app.config['COMPRESS_REGISTER'] = True
    app.config['COMPRESS_MIMETYPES'] = [
        'application/json',
        'text/html',
        'text/plain',
        'text/css',
        'application/javascript',
    ]
    app.config['COMPRESS_MIN_SIZE'] = 500  # bytes — skip tiny payloads
    logging.getLogger(__name__).info("[app] ✅ flask_compress enabled (Gzip/Brotli)")
except ImportError:
    logging.getLogger(__name__).warning("[app] ⚠️  flask_compress not installed — responses will be uncompressed")

# ── GeoJSON in-memory preload ───────────────────────────────────────────────
preload_all()

# ── Database index migration (idempotent, runs at startup) ──────────────────
def _apply_db_indexes_background():
    """Run index migration in a background thread so startup isn't blocked."""
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass
    db_url = os.environ.get('DATABASE_URL')
    # Remap Docker hostname only when running locally (outside Docker)
    if db_url and '@postgres:' in db_url and not os.path.exists('/.dockerenv'):
        db_url = db_url.replace('@postgres:5432', '@localhost:5433')
    try:
        from utils.db_indexes import apply_indexes_sync
        apply_indexes_sync(db_url)
    except Exception as exc:
        logging.getLogger(__name__).warning(f"[app] DB index migration skipped (DB may be offline): {exc}")

threading.Thread(target=_apply_db_indexes_background, daemon=True).start()

queue_manager.start()


# ── Serialization helper ─────────────────────────────────────────────────────
def _strip_nulls(obj):
    """Recursively remove None/empty values from dicts to reduce payload size."""
    if isinstance(obj, dict):
        return {k: _strip_nulls(v) for k, v in obj.items() if v is not None and v != "" and v != []}
    if isinstance(obj, list):
        return [_strip_nulls(i) for i in obj]
    return obj



# Hilo para la Etapa 2 (Streaming)
def run_orchestrator_mapping(search_params, q):
    async def _run():
        orchestrator = OrchestratorAgent()
        await orchestrator.init_cache()
        try:
            async for event in orchestrator.map_stream(search_params):
                q.put(event)
        except Exception as e:
            q.put({"type": "error", "message": str(e)})
        finally:
            q.put(None)
            await orchestrator.close()
    
    asyncio.run(_run())

@app.route('/')
def index():
    from chatbot import get_model_display_name
    return render_template('index.html', chatbot_model=get_model_display_name())

@app.route('/api/available-maps', methods=['GET'])
def available_maps():
    config_path = os.path.join(app.root_path, 'static', 'maps', 'map_config.json')
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)
        maps_list = [{"key": k, "country_name": v.get("country_name", k)} for k, v in config.items()]
        return jsonify(maps_list)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

#  (ETAPA 1): Botón "Buscar Noticias Rápidas"
@app.route('/api/discovery', methods=['GET'])
@rate_limit(limit=15, window=60)
def api_discovery():
    sanitized_args = sanitize_payload(request.args.to_dict())
    search_params = {
        'query': sanitized_args.get('query', ''),
        'nqueries': sanitized_args.get('nqueries', '15'),
        'country': sanitized_args.get('country', 'mx'),
        'qrangedate': sanitized_args.get('qrangedate', ''),
        'qexception': sanitized_args.get('qexception', ''),
        'qoption': sanitized_args.get('qoption', ''),
        'qsite': sanitized_args.get('qsite', '')
    }
    
    import uuid
    import json
    execution_id = str(uuid.uuid4())
    search_term = search_params.get('query', '')
    filters_json = json.dumps(search_params)
    
    async def _fetch():
        orchestrator = OrchestratorAgent()
        try:
            # Insert SCRAPING state synchronously so UI picks it up immediately
            await orchestrator.init_history_db()
            async with orchestrator.history_db.acquire() as conn:
                await conn.execute("ALTER TABLE search_executions ADD COLUMN IF NOT EXISTS end_time TIMESTAMP;")
                await conn.execute(
                    "INSERT INTO search_executions (execution_id, search_term, filters, status) VALUES ($1, $2, $3::jsonb, 'SCRAPING')",
                    execution_id, search_term, filters_json
                )
            
            result = await orchestrator.fetch_discovery(search_params, execution_id)
            if isinstance(result, tuple) and len(result) == 2:
                return result[1]
            return result
        finally:
            await orchestrator.close()
            
    try:
        articles = asyncio.run(_fetch())
        return jsonify({
            "execution_id": execution_id,
            "articles": articles
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# (ETAPA 2): Botón "Mapear Tendencias"
@app.route('/api/jobs/start', methods=['POST'])
def start_job():
    data = request.get_json(silent=True) or {}
    search_params = {
        'query': request.args.get('query', '') or data.get('query', ''),
        'nqueries': request.args.get('nqueries', '15') or data.get('nqueries', '15'),
        'country': request.args.get('country', 'mx') or data.get('country', 'mx'),
        'qrangedate': request.args.get('qrangedate', '') or data.get('qrangedate', ''),
        'qexception': request.args.get('qexception', '') or data.get('qexception', ''),
        'qoption': request.args.get('qoption', '') or data.get('qoption', ''),
        'qsite': request.args.get('qsite', '') or data.get('qsite', '')
    }

    try:
        import uuid
        import json
        import asyncio
        from agents import OrchestratorAgent
        
        execution_id = str(uuid.uuid4())
        search_term = search_params.get('query', '')
        filters_json = json.dumps(search_params)
        
        # Synchronously insert the execution so it shows up immediately in the UI
        async def init_exec():
            orchestrator = OrchestratorAgent()
            await orchestrator.init_history_db()
            async with orchestrator.history_db.acquire() as conn:
                await conn.execute("ALTER TABLE search_executions ADD COLUMN IF NOT EXISTS end_time TIMESTAMP;")
                await conn.execute(
                    "INSERT INTO search_executions (execution_id, search_term, filters, status) VALUES ($1, $2, $3::jsonb, 'SCRAPING')",
                    execution_id, search_term, filters_json
                )
        asyncio.run(init_exec())

        def run_in_background():
            async def phase1():
                orchestrator = OrchestratorAgent()
                await orchestrator.init_cache()
                try:
                    await orchestrator.fetch_discovery(search_params, execution_id)
                finally:
                    await orchestrator.close()
            asyncio.run(phase1())
                
        import threading
        threading.Thread(target=run_in_background, daemon=True).start()
        
        return jsonify({"success": True, "run_id": execution_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/jobs', methods=['GET'])
def list_jobs():
    try:
        import asyncpg
        import asyncio
        from agents import OrchestratorAgent
        
        async def fetch_jobs():
            import os
            db_url = os.environ.get('DATABASE_URL')
            try:
                pool = await asyncpg.create_pool(db_url)
            except Exception:
                if '@postgres:' in db_url:
                    db_url = db_url.replace('@postgres:5432', '@localhost:5433')
                    pool = await asyncpg.create_pool(db_url)
            try:
                async with pool.acquire() as conn:
                    await conn.execute("ALTER TABLE search_executions ADD COLUMN IF NOT EXISTS end_time TIMESTAMP;")
                    rows = await conn.fetch("SELECT execution_id, search_term, status, timestamp, end_time FROM search_executions ORDER BY timestamp DESC LIMIT 20")
                    
                    import datetime
                    def to_iso(dt):
                        if not dt: return None
                        if dt.tzinfo is None:
                            dt = dt.replace(tzinfo=datetime.timezone.utc)
                        return dt.isoformat()
                    
                    jobs_data = []
                    for r in rows:
                        prog = get_progress(r['execution_id'])
                        
                        jobs_data.append({
                            "run_id": r['execution_id'],
                            "status": r['status'],
                            "query": r['search_term'],
                            "start_time": to_iso(r['timestamp']),
                            "end_time": to_iso(r['end_time']),
                            "progress_pct": prog["progress_pct"],
                            "current_step": prog["current_step"]
                        })
                    return jobs_data
            finally:
                await pool.close()
                
        jobs_data = asyncio.run(fetch_jobs())
        return jsonify(jobs_data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/jobs/<execution_id>/analyze', methods=['POST'])
def analyze_job(execution_id):
    try:
        import asyncio
        from agents import OrchestratorAgent
        async def update_status():
            orchestrator = OrchestratorAgent()
            await orchestrator.init_history_db()
            async with orchestrator.history_db.acquire() as conn:
                await conn.execute("UPDATE search_executions SET status = 'QUEUED_FOR_ANALYSIS' WHERE execution_id = $1", execution_id)
        asyncio.run(update_status())
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/jobs/<execution_id>/resume_scraping', methods=['POST'])
def resume_scraping(execution_id):
    try:
        import asyncio
        import json
        from agents import OrchestratorAgent
        
        async def _resume():
            orchestrator = OrchestratorAgent()
            await orchestrator.init_history_db()
            async with orchestrator.history_db.acquire() as conn:
                row = await conn.fetchrow("SELECT filters FROM search_executions WHERE execution_id = $1", execution_id)
                if not row:
                    return {"error": "Job not found"}
                filters = json.loads(row['filters'])
                await conn.execute("UPDATE search_executions SET status = 'SCRAPING' WHERE execution_id = $1", execution_id)
            
            try:
                await orchestrator.fetch_discovery(filters, execution_id)
            finally:
                await orchestrator.close()
            return {"success": True}
            
        # Corremos en background para no bloquear
        import threading
        def bg_run():
            asyncio.run(_resume())
            
        t = threading.Thread(target=bg_run)
        t.start()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/jobs/<execution_id>/cancel', methods=['POST'])
def cancel_job(execution_id):
    try:
        import asyncio
        from agents import OrchestratorAgent
        async def update_status():
            orchestrator = OrchestratorAgent()
            await orchestrator.init_history_db()
            async with orchestrator.history_db.acquire() as conn:
                await conn.execute("UPDATE search_executions SET status = 'CANCELLED' WHERE execution_id = $1", execution_id)
        asyncio.run(update_status())
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500



import zipfile

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

@app.route('/download/excel', methods=['POST'])
def download_excel():
    data = request.json
    if not data:
        return {"error": "Invalid data"}, 400
        
    if isinstance(data, dict):
        articles = data.get('articles', [])
        metadata = data.get('params', data.get('metadata', {}))
    elif isinstance(data, list):
        articles = data
        metadata = {}
    else:
        return {"error": "Invalid data format"}, 400

    if not articles:
        return {"error": "No articles to export"}, 400

    timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_filename = f"news_export_{timestamp_str}.zip"
    excel_filename = f"news_data_{timestamp_str}.xlsx"

    # 1. Primary Sheet ("Data")
    df_data = pd.DataFrame(articles)
    if 'Resumen Extraído' in df_data.columns:
        df_data = df_data.drop(columns=['Resumen Extraído'])
    if 'Fecha de Extracción' not in df_data.columns:
        df_data['Fecha de Extracción'] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # 2. Secondary Sheet ("Metadata")
    if metadata:
        meta_items = [{"Parámetro": k, "Valor": str(v)} for k, v in metadata.items()]
    else:
        meta_items = [
            {"Parámetro": "Fecha y Hora de Exportación", "Valor": datetime.now().strftime("%Y-%m-%d %H:%M:%S")},
            {"Parámetro": "Total Artículos", "Valor": str(len(articles))}
        ]
    df_meta = pd.DataFrame(meta_items)

    # 3. In-memory Multi-sheet Excel
    excel_buffer = io.BytesIO()
    with pd.ExcelWriter(excel_buffer, engine='openpyxl') as writer:
        df_data.to_excel(writer, index=False, sheet_name='Data')
        df_meta.to_excel(writer, index=False, sheet_name='Metadata')
    excel_buffer.seek(0)

    # 4. In-memory ZIP archive packaging Excel and images/ folder
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        zip_file.writestr(excel_filename, excel_buffer.getvalue())

        added_images = set()
        for row in articles:
            img_val = row.get("Ruta de Imagen") or row.get("image") or ""
            if img_val and isinstance(img_val, str):
                img_name = os.path.basename(img_val.strip("/\\"))
                full_img_path = os.path.join(BASE_DIR, "static", "news_images", img_name)
                if not os.path.exists(full_img_path):
                    clean_rel = img_val.lstrip("/\\")
                    full_img_path = os.path.join(BASE_DIR, clean_rel)

                if os.path.exists(full_img_path) and full_img_path not in added_images:
                    zip_file.write(full_img_path, arcname=f"images/{img_name}")
                    added_images.add(full_img_path)

    zip_buffer.seek(0)
    return Response(
        zip_buffer.read(),
        mimetype="application/zip",
        headers={
            "Content-disposition": f"attachment; filename={zip_filename}",
            "Access-Control-Expose-Headers": "Content-Disposition"
        }
    )

@app.route('/api/history', methods=['GET'])
def get_history_list():
    async def _fetch():
        orchestrator = OrchestratorAgent()
        try:
            return await orchestrator.get_history_list()
        finally:
            await orchestrator.close()

    try:
        import datetime
        def to_iso(dt):
            if not dt: return None
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=datetime.timezone.utc)
            return dt.isoformat()
            
        history = asyncio.run(_fetch())
        # Convert datetime objects to string for JSON serialization
        for run in history:
            if 'timestamp' in run and run['timestamp']:
                run['timestamp'] = to_iso(run['timestamp'])
            if 'end_time' in run and run['end_time']:
                run['end_time'] = to_iso(run['end_time'])
            if 'scraped_at' in run and run['scraped_at']:
                run['scraped_at'] = to_iso(run['scraped_at'])
        return jsonify(_strip_nulls(history))
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/history/<execution_id>', methods=['GET'])
def get_history_detail(execution_id):
    async def _fetch():
        orchestrator = OrchestratorAgent()
        try:
            return await orchestrator.get_history_detail(execution_id)
        finally:
            await orchestrator.close()

    try:
        import datetime
        def to_iso(dt):
            if not dt: return None
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=datetime.timezone.utc)
            return dt.isoformat()

        detail = asyncio.run(_fetch())
        if not detail:
            return jsonify({"error": "Execution not found"}), 404
            
        # Convert datetime
        if 'timestamp' in detail['execution'] and detail['execution']['timestamp']:
            detail['execution']['timestamp'] = to_iso(detail['execution']['timestamp'])
        if 'end_time' in detail['execution'] and detail['execution']['end_time']:
            detail['execution']['end_time'] = to_iso(detail['execution']['end_time'])
        if 'scraped_at' in detail['execution'] and detail['execution']['scraped_at']:
            detail['execution']['scraped_at'] = to_iso(detail['execution']['scraped_at'])
            
        return jsonify(detail)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/analytics/aggregate', methods=['POST'])
def aggregate_analytics():
    data = request.get_json(silent=True) or {}
    execution_ids = data.get('execution_ids', [])
    print(f"AGGREGATE CALLED with ids: {execution_ids}", flush=True)
    
    if not execution_ids or not isinstance(execution_ids, list):
        return jsonify({"error": "Invalid or missing execution_ids"}), 400

    async def _fetch():
        from agents import OrchestratorAgent
        orchestrator = OrchestratorAgent()
        try:
            return await orchestrator.get_aggregated_history(execution_ids)
        finally:
            await orchestrator.close()

    try:
        import datetime
        def to_iso(dt):
            if not dt: return None
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=datetime.timezone.utc)
            return dt.isoformat()

        detail = asyncio.run(_fetch())
        print(f"AGGREGATE FETCH RETURNED: {detail}", flush=True)
        if not detail or not detail.get('executions'):
            return jsonify({"error": "No executions found"}), 404
            
        for exec_record in detail['executions']:
            if 'timestamp' in exec_record and exec_record['timestamp']:
                exec_record['timestamp'] = to_iso(exec_record['timestamp'])
            if 'end_time' in exec_record and exec_record['end_time']:
                exec_record['end_time'] = to_iso(exec_record['end_time'])
            if 'scraped_at' in exec_record and exec_record['scraped_at']:
                exec_record['scraped_at'] = to_iso(exec_record['scraped_at'])
            
        return jsonify(_strip_nulls(detail))
    except Exception as e:
        print(f"AGGREGATE ERROR: {e}", flush=True)
        return jsonify({"error": str(e)}), 500


# ── In-memory GeoJSON endpoint ──────────────────────────────────────────────
@app.route('/api/geojson/<country>', methods=['GET'])
def get_geojson_endpoint(country):
    """
    Serve GeoJSON FeatureCollections directly from memory — no disk I/O.
    Previously this was delegated to static file serving which re-parsed
    the 361 KB mx_states.geojson on every request.
    """
    data = get_geojson(country.lower())
    if not data:
        return jsonify({"error": f"No GeoJSON found for country '{country}'"}), 404
    # flask_compress will automatically Gzip/Brotli this large payload
    return jsonify(data)


@app.route('/api/geojson', methods=['GET'])
def list_geojson_countries():
    """Return the list of country keys that have preloaded GeoJSON data."""
    return jsonify(get_available_countries())



# ── Analytic Chatbot SSE Endpoint ─────────────────────────────────────────────

@app.route('/api/chat/history', methods=['GET'])
def get_chat_history():
    execution_id = request.args.get('execution_id')
    if not execution_id:
        return jsonify({"error": "execution_id required"}), 400
        
    try:
        from utils.crypto import decrypt_data
        import asyncpg
        import asyncio
        import os
        
        async def fetch_history():
            db_url = os.environ.get('DATABASE_URL')
            if db_url and '@postgres:' in db_url:
                db_url = db_url.replace('@postgres:5432', '@localhost:5433')
            elif not db_url:
                db_url = "postgresql://admin:admin123@localhost:5433/history_db"
                
            conn = await asyncpg.connect(db_url)
            rows = await conn.fetch("SELECT role, encrypted_content, timestamp FROM chat_history WHERE execution_id = $1 ORDER BY timestamp ASC", execution_id)
            await conn.close()
            
            history = []
            for r in rows:
                history.append({
                    "role": r['role'],
                    "content": decrypt_data(r['encrypted_content']),
                    "timestamp": r['timestamp'].isoformat()
                })
            return history
            
        history = asyncio.run(fetch_history())
        return jsonify(history)
    except Exception as e:
        app.logger.error(f"Error fetching chat history: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/chat/info', methods=['GET'])
def chat_info():
    """
    Public metadata endpoint for the chatbot.
    Returns only safe, sanitized presentation information (no keys, secrets, or internal paths).
    """
    from chatbot import get_model_display_name
    return jsonify({
        "model_name": get_model_display_name(),
        "status": "ready"
    })


@app.route('/api/chat/stream', methods=['POST'])
@rate_limit(limit=10, window=60)
def chat_stream():
    """
    SSE endpoint for the analytic chatbot.
    Expects JSON: { "message": "...", "execution_id": "<optional>" }
    Returns: text/event-stream with tokens, [DONE], or [ERROR]/[QUOTA]/[RATE_LIMITED].
    """
    from chatbot import stream_chat_response

    raw_data = request.get_json(silent=True) or {}
    data = sanitize_payload(raw_data)
    message = (data.get("message") or "").strip()
    execution_id = data.get("execution_id") or None
    chat_history = raw_data.get("chat_history") or raw_data.get("history") or None

    if not message:
        return jsonify({"error": "message is required"}), 400

    # Resolve client IP (respects X-Forwarded-For behind proxies)
    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "unknown").split(",")[0].strip()

    def generate():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            async def run():
                async for chunk in stream_chat_response(message, execution_id=execution_id, ip=ip, chat_history=chat_history):
                    yield chunk
            gen = run()
            while True:
                try:
                    chunk = loop.run_until_complete(gen.__anext__())
                    yield chunk
                except StopAsyncIteration:
                    break
        finally:
            loop.close()

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


if __name__ == '__main__':
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass
    is_debug = os.environ.get('FLASK_DEBUG', 'False').lower() in ('true', '1', 't')
    app.run(host='0.0.0.0', debug=is_debug, port=5000)