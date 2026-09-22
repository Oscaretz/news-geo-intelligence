import os
import json
import asyncio
import asyncpg
from dagster import (
    asset, 
    Definitions, 
    RetryPolicy, 
    ScheduleDefinition, 
    define_asset_job, 
    DefaultScheduleStatus,
    Config
)

class ScraperConfig(Config):
    query: str = "noticias mexico"
    nqueries: str = "15"
    country: str = "mx"
    qrangedate: str = ""
    qexception: str = ""
    qoption: str = ""
    qsite: str = ""

# Import the logic built in previous phases
from utils.llm_batch import process_articles_batch
from utils.olap_db import load_metrics_upsert

# Simple async wrapper for Dagster assets
def run_async(coro):
    import asyncio
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    if loop and loop.is_running():
        return asyncio.ensure_future(coro)
    else:
        return asyncio.run(coro)

async def _get_pool():
    db_url = os.environ.get('DATABASE_URL')
    if '@postgres:' in db_url and not os.path.exists('/.dockerenv'):
        db_url = db_url.replace('@postgres:5432', '@localhost:5433')
    return await asyncpg.create_pool(db_url)

@asset
def extract_daily_news() -> list:
    """Fetches unprocessed news delta from PostgreSQL."""
    async def _fetch():
        pool = await _get_pool()
        async with pool.acquire() as conn:
            # Get articles that don't exist in fact_news_metrics yet
            rows = await conn.fetch('''
                SELECT a.article_id, a.execution_id, a.title, a.content_snippet, a.date as date_str, a.source as source_name, a.url 
                FROM articles a
                LEFT JOIN fact_news_metrics f ON a.article_id = f.article_id AND a.execution_id = f.execution_id
                WHERE f.article_id IS NULL
                LIMIT 50
            ''')
        await pool.close()
        return [dict(r) for r in rows]
    return run_async(_fetch())

@asset(retry_policy=RetryPolicy(max_retries=3, delay=10))
def transform_metrics(extract_daily_news: list) -> list:
    """Processes texts in small batches asynchronously using Phase 7.2 LLM logic."""
    if not extract_daily_news:
        return []
        
    async def _transform():

        from utils.llm_batch import extract_metrics_batch, LLMExtractionError
        from utils.schemas import BatchNewsMetrics
        
        batch_size = 5
        all_results = []
        for i in range(0, len(extract_daily_news), batch_size):
            batch = extract_daily_news[i:i+batch_size]
            data_map = {
                a['article_id']: {
                    'title': a.get('title') or '',
                    'text': a.get('content_snippet') or ''
                }
                for a in batch
            }
            
            try:
                raw_json_str = await extract_metrics_batch(data_map)
                parsed_data = json.loads(raw_json_str)
                results = parsed_data.get('results', [])
                
                # Merge original article data with metrics
                for r in results:
                    art_id = r.get('article_id')
                    original_art = next((a for a in batch if a['article_id'] == art_id), None)
                    if original_art:
                        merged = dict(original_art)
                        merged.update(r)
                        merged['word_count'] = len((merged.get('content_snippet') or '').split())
                        merged['entity_count'] = len(r.get('entities_list', []))
                        all_results.append(merged)
            except Exception as e:
                # In a real DLQ we would insert here, but we can just raise to retry the asset
                raise Exception(f"Batch transformation failed: {e}")
        return all_results
    return run_async(_transform())

@asset
def load_star_schema(transform_metrics: list):
    """Uses the Phase 7.1 upsert function to load the processed data into analytical tables."""
    if not transform_metrics:
        return
        
    async def _load():
        pool = await _get_pool()
        # load_metrics_upsert handles dim_date, dim_source, and fact_news_metrics.
        await load_metrics_upsert(pool, transform_metrics)
        

        from utils.olap_db import load_entities_upsert
        entities_data = []
        for m in transform_metrics:
            art_id = m.get('article_id')
            exec_id = m.get('execution_id')
            for ent in m.get('entities_list', []):
                entities_data.append({
                    'article_id': art_id,
                    'execution_id': exec_id,
                    'entity_text': ent.get('entity_text'),
                    'entity_type': ent.get('entity_type')
                })
        if entities_data:
            await load_entities_upsert(pool, entities_data)
            
        await pool.close()
    
    run_async(_load())

@asset
def discover_articles(config: ScraperConfig) -> str:
    """Initializes OrchestratorAgent, fetches discovery, returns execution_id."""
    from agents import OrchestratorAgent
    from utils.job_progress_store import update_progress
    import uuid

    async def _scrape():
        orchestrator = OrchestratorAgent()
        await orchestrator.init_cache()
        try:
            run_id = str(uuid.uuid4())
            update_progress(run_id, 10, "Fetching discovery (10%)...")
            execution_id, _ = await orchestrator.fetch_discovery(config.model_dump())
            return execution_id
        finally:
            await orchestrator.close()
            
    return run_async(_scrape())

@asset(retry_policy=RetryPolicy(max_retries=3, delay=15))
def geocode_articles(discover_articles: str):
    """Processes stream mapping and geocodes using OrchestratorAgent."""
    from agents import OrchestratorAgent
    from utils.job_progress_store import update_progress
    import uuid

    async def _geocode():
        orchestrator = OrchestratorAgent()
        await orchestrator.init_cache()
        try:
            run_id = str(uuid.uuid4())
            update_progress(run_id, 40, "Extracting articles (40%)...")
            
            async for event in orchestrator.map_stream(discover_articles):
                current = event.get("current", 0)
                target = max(event.get("target", 1), 1)
                progress = 40 + min((current / target) * 50, 50)
                update_progress(run_id, progress, f"Geocoding articles ({current}/{target})...")
                
            update_progress(run_id, 100, "Saving to database...")
        finally:
            await orchestrator.close()
            
    run_async(_geocode())

etl_job = define_asset_job("daily_news_etl_job", selection=["extract_daily_news", "transform_metrics", "load_star_schema"])
scraper_job = define_asset_job("raw_news_scraper_job", selection=["discover_articles", "geocode_articles"])

daily_news_etl_schedule = ScheduleDefinition(
    name="daily_news_etl_schedule",
    job=etl_job,
    cron_schedule="0 4 * * *",
    default_status=DefaultScheduleStatus.STOPPED,
)

scraper_daily_schedule = ScheduleDefinition(
    name="scraper_daily_schedule",
    job=scraper_job,
    cron_schedule="0 2 * * *",
    default_status=DefaultScheduleStatus.STOPPED,
)

defs = Definitions(
    assets=[extract_daily_news, transform_metrics, load_star_schema, discover_articles, geocode_articles],
    jobs=[etl_job, scraper_job],
    schedules=[daily_news_etl_schedule, scraper_daily_schedule],
)
