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
from static.py.job_progress_store import get_progress

from static.py.phase2_queue import queue_manager

import logging
class NoJobsFilter(logging.Filter):
    def filter(self, record):
        return '/api/jobs HTTP' not in record.getMessage()

logging.getLogger('werkzeug').addFilter(NoJobsFilter())

app = Flask(__name__)
queue_manager.start()


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
    return render_template('index.html')

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
def api_discovery():
    search_params = {
        'query': request.args.get('query', ''),
        'nqueries': request.args.get('nqueries', '15'),
        'country': request.args.get('country', 'mx'),
        'qrangedate': request.args.get('qrangedate', ''),
        'qexception': request.args.get('qexception', ''),
        'qoption': request.args.get('qoption', ''),
        'qsite': request.args.get('qsite', '')
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
            
    articles = asyncio.run(_fetch())
    return jsonify(articles)


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
            db_url = os.environ.get('DATABASE_URL', 'postgresql://admin:admin123@postgres:5432/history_db')
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
                await conn.execute("UPDATE search_executions SET status = 'SCRAPED' WHERE execution_id = $1 AND status = 'QUEUED_FOR_ANALYSIS'", execution_id)
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
        return jsonify(history)
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

if __name__ == '__main__':
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass
    app.run(host='0.0.0.0', debug=True, port=5000)