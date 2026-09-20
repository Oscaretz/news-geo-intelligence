# AI News Explorer

An enterprise-grade, highly concurrent web scraping and analytical platform designed for automated news discovery, geolocation mapping, and LLM-powered context generation.

## 🚀 Features

- **Concurrent Web Scraping**: Resilient evasion of anti-bot protections using `curl_cffi` and `Playwright`.
- **Intelligent Discovery**: Initial aggregation via Google News RSS feeds to deduplicate and capture direct URLs.
- **LLM Pipeline (RAG)**: Integration with Groq (Llama-3, Mixtral) and Gemini for semantic analysis and geographic extraction.
- **Data Persistence & OLAP**: PostgreSQL backend for historical tracking, DLQ for scraping failures, and an OLAP schema for BI analytics.
- **Interactive UI**: A dashboard built with Flask and TailwindCSS featuring cross-filtering (BI logic), interactive Leaflet maps, and real-time execution job tracking.
- **Chatbot Assistant**: Context-aware RAG chatbot allowing users to query over scraped metrics.
- **Dagster Orchestration**: Scheduled job management and multi-phase data pipelines.

## 🏗 Architecture

1. **Phase 1: Discovery & Extraction**
   - RSS discovery -> URL Resolution -> Trafilatura/BS4 extraction -> Full-text caching.
2. **Phase 2: LLM Inference & Geocoding**
   - Extracted text -> LLM State/Country Identification -> GeoJSON Mapping -> PostgreSQL (History & OLAP).
3. **Phase 3: Real-Time Visualization**
   - SSE streaming to the frontend -> Cross-filtering Dashboard -> LLM Chatbot Context.

## ⚙️ Setup & Deployment

1. Configure environment variables (use the template):
   ```bash
   cp .env.template .env
   ```
2. Build and run via Docker Compose:
   ```bash
   docker compose up --build -d
   ```
3. Access the application at `http://localhost:5000` and Dagster UI at `http://localhost:3000`.

## 🛠 Tech Stack

- **Backend**: Python (Flask, Asyncio, Dagster)
- **Database**: PostgreSQL (asyncpg, psycopg2)
- **Scraping**: curl_cffi, Playwright, Trafilatura, BeautifulSoup
- **Frontend**: TailwindCSS, Leaflet.js, Chart.js, HTML5/Vanilla JS
- **AI/LLM**: Groq API, Google GenAI

