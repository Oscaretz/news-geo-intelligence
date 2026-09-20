import logging
logger = logging.getLogger(__name__)
import asyncio
import threading
import time
from agents import OrchestratorAgent
from utils.job_progress_store import update_progress

class QueueManager:
    def __init__(self):
        self.active_execution_id = None
        self.lock = asyncio.Lock()
        self.running = False

    async def _process_queue(self):
        orchestrator = OrchestratorAgent()
        await orchestrator.init_history_db()
        while self.running:
            try:
                execution_id = None
                async with self.lock:
                    if self.active_execution_id is not None:
                        # Already analyzing
                        pass
                    else:
                        async with orchestrator.history_db.acquire() as conn:
                            row = await conn.fetchrow("SELECT execution_id, search_term FROM search_executions WHERE status = 'QUEUED_FOR_ANALYSIS' ORDER BY timestamp ASC LIMIT 1")
                            if row:
                                execution_id = row['execution_id']
                                self.active_execution_id = execution_id
                                await conn.execute("UPDATE search_executions SET status = 'ANALYZING', end_time = NULL WHERE execution_id = $1", execution_id)
                
                if execution_id:
                    # Execute phase 2!
                    try:
                        update_progress(execution_id, 0, "Iniciando análisis LLM...")
                        
                        # We use country from a fallback or fetch it, default 'mx'
                        async for event in orchestrator.map_stream(execution_id, country="mx"):
                            current = event.get("current", 0)
                            target = max(event.get("target", 1), 1)
                            progress = min((current / target) * 100, 100)
                            update_progress(execution_id, progress, f"Analizando artículos ({current}/{target})...")
                            
                        update_progress(execution_id, 100, "Análisis completo.")
                    except Exception as e:
                        logger.error(f"Error in LLM queue process for {execution_id}: {e}")
                    finally:
                        async with self.lock:
                            self.active_execution_id = None
                else:
                    await asyncio.sleep(2)
            except Exception as e:
                logger.error(f"Queue error: {e}")
                await asyncio.sleep(2)

    def start(self):
        self.running = True
        
        def run_loop():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            loop.run_until_complete(self._process_queue())
            
        threading.Thread(target=run_loop, daemon=True).start()

    def stop(self):
        self.running = False

queue_manager = QueueManager()
