import asyncio
import os
import sys

from agents import OrchestratorAgent

async def main():
    print("Testing OrchestratorAgent cache init...")
    orch = OrchestratorAgent()
    await orch.init_cache()
    
    print("Testing Phase 1: fetch_discovery...")
    search_params = {
        "query": "México",
        "nqueries": "2",
    }
    
    # Run Phase 1
    articles = await orch.fetch_discovery(search_params)
    print(f"Phase 1 complete: Discovered {len(articles)} articles.")
    for idx, art in enumerate(articles):
        print(f"Article {idx}: {art.get('title')} | Image: {art.get('image')} | Real URL: {art.get('real_url')}")
        
    print("\nTesting Phase 2: map_stream (offline)...")
    # Run Phase 2
    async for event in orch.map_stream(search_params):
        if event.get("type") == "article":
            a = event["data"]
            print(f"Mapped Article Yielded: {a.get('title')} | Image: {a.get('image')} | States: {a.get('states')}")
        elif event.get("type") == "update":
            print(f"Update: {event.get('message')} | Phase: {event.get('phase')} | Current/Target: {event.get('current')}/{event.get('target')} | Time: {event.get('elapsed_time')}")
            
    await orch.close()
    print("Pipeline test successful.")

if __name__ == "__main__":
    asyncio.run(main())
