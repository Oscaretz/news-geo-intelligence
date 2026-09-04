import os
import platform
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

import asyncio
from dagster import op, job, Config
from agents import OrchestratorAgent

class SearchConfig(Config):
    query: str
    nqueries: str = "15"
    country: str = "mx"
    qrangedate: str = ""
    qexception: str = ""
    qoption: str = ""
    qsite: str = ""

from job_progress_store import update_progress
import hashlib
import json

@op
def run_search_pipeline(context, config: SearchConfig):
    run_id = context.run_id
    search_params = {
        'query': config.query,
        'nqueries': config.nqueries,
        'country': config.country,
        'qrangedate': config.qrangedate,
        'qexception': config.qexception,
        'qoption': config.qoption,
        'qsite': config.qsite
    }
    
    async def _run():
        orchestrator = OrchestratorAgent()
        await orchestrator.init_cache()
        try:
            update_progress(run_id, 10, "Fetching discovery (10%)...")
            # Fase 1: Scraping, resolución de texto completo y pre-guardado en cache
            await orchestrator.fetch_discovery(search_params)
            
            update_progress(run_id, 40, "Extracting articles (40%)...")
            # Fase 2: Inferencia LLM, geolocalización y guardado en PostgreSQL (History)
            
            async for event in orchestrator.map_stream(search_params):
                current = event.get("current", 0)
                target = max(event.get("target", 1), 1)
                
                # event type update is the init message, event type article is per article
                progress = 40 + min((current / target) * 50, 50)
                update_progress(run_id, progress, f"Geocoding articles ({current}/{target})...")
                
            update_progress(run_id, 100, "Saving to database...")
        finally:
            await orchestrator.close()
            
    asyncio.run(_run())
    return True

@job
def search_job():
    run_search_pipeline()

# ============================================
# Automatización (Schedules)
# ============================================
from dagster import ScheduleDefinition, Definitions

# Ejemplo de horario: Corre todos los días a las 8:00 AM
daily_mexico_news_schedule = ScheduleDefinition(
    job=search_job,
    cron_schedule="0 8 * * *",
    run_config={
        "ops": {
            "run_search_pipeline": {
                "config": {
                    "query": "noticias mexico",
                    "nqueries": "15",
                    "country": "mx"
                }
            }
        }
    }
)

defs = Definitions(
    jobs=[search_job],
    schedules=[daily_mexico_news_schedule]
)
