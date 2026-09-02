import os
import io
import json
import queue
import threading
import asyncio
from datetime import datetime
from constants import MEXICAN_STATES

import pandas as pd
from flask import Flask, render_template, request, Response, jsonify

from agents import OrchestratorAgent

app = Flask(__name__)

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
    return render_template('index.html', states_data=MEXICAN_STATES)

#  (ETAPA 1): Botón "Buscar Noticias Rápidas"
@app.route('/api/discovery', methods=['GET'])
def api_discovery():
    search_params = {
        'query': request.args.get('query', ''),
        'nqueries': request.args.get('nqueries', '15'),
        'qrangedate': request.args.get('qrangedate', ''),
        'qexception': request.args.get('qexception', ''),
        'qoption': request.args.get('qoption', ''),
        'qsite': request.args.get('qsite', '')
    }
    
    async def _fetch():
        orchestrator = OrchestratorAgent()
        try:
            return await orchestrator.fetch_discovery(search_params)
        finally:
            await orchestrator.close()
            
    articles = asyncio.run(_fetch())
    return jsonify(articles)


# (ETAPA 2): Botón "Mapear Tendencias"
@app.route('/stream')
def stream():
    search_params = {
        'query': request.args.get('query', ''),
        'nqueries': request.args.get('nqueries', '15'),
        'qrangedate': request.args.get('qrangedate', ''),
        'qexception': request.args.get('qexception', ''),
        'qoption': request.args.get('qoption', ''),
        'qsite': request.args.get('qsite', '')
    }

    q = queue.Queue()
    threading.Thread(target=run_orchestrator_mapping, args=(search_params, q), daemon=True).start()

    def generate():
        while True:
            event = q.get()
            if event is None:
                yield f"data: {json.dumps({'type': 'complete'})}\n\n"
                break
            yield f"data: {json.dumps(event)}\n\n"

    return Response(generate(), mimetype='text/event-stream')


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

if __name__ == '__main__':
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass
    app.run(host='0.0.0.0', debug=True, port=5000)