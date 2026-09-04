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

@op
def run_search_pipeline(config: SearchConfig):
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
            # Fase 1: Scraping, resolución de texto completo y pre-guardado en cache
            await orchestrator.fetch_discovery(search_params)
            # Fase 2: Inferencia LLM, geolocalización y guardado en PostgreSQL (History)
            async for event in orchestrator.map_stream(search_params):
                pass
        finally:
            await orchestrator.close()
            
    asyncio.run(_run())
    return True

@job
def search_job():
    run_search_pipeline()
