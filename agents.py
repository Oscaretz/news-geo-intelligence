from dotenv import load_dotenv
load_dotenv()
from utils.job_progress_store import update_progress
from utils.geojson_cache import get_map_config, get_geojson, get_valid_regions, preload_all
import os
import re
import json
import time
import random
import asyncio
import logging
import hashlib
import uuid
from PIL import Image
from zoneinfo import ZoneInfo
import urllib.parse
import email.utils
from datetime import datetime
from xml.etree import ElementTree
from concurrent.futures import ThreadPoolExecutor

import asyncpg
import aiosqlite
from bs4 import BeautifulSoup
from tenacity import retry, wait_exponential, stop_after_attempt

from curl_cffi.requests import AsyncSession, Session
from playwright.async_api import async_playwright

# Ensure absolute path for log directory
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_DIR = os.path.join(BASE_DIR, "logs")
if not os.path.exists(LOG_DIR):
    os.makedirs(LOG_DIR)

# Define local timezone
LOCAL_TZ = ZoneInfo("America/Merida")

log_filename = f"logs/scraping_{datetime.now(LOCAL_TZ).strftime('%Y-%m-%d')}.log"

class TimezoneFormatter(logging.Formatter):
    def formatTime(self, record, datefmt=None):
        dt = datetime.fromtimestamp(record.created, tz=LOCAL_TZ)
        if datefmt:
            return dt.strftime(datefmt)
        return dt.strftime('%Y-%m-%d %H:%M:%S,%f')[:-3]

# Apply configuration directly to the root logger to avoid conflicts with Flask
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Clear previous handlers to avoid duplicates
if logger.hasHandlers():
    logger.handlers.clear()

formatter = TimezoneFormatter('%(asctime)s [%(levelname)s] %(message)s')

# Remove FileHandler as Docker handles logging natively via StreamHandler

stream_handler = logging.StreamHandler()
stream_handler.setFormatter(formatter)
logger.addHandler(stream_handler)

logger = logging.getLogger(__name__)


def extract_image_url(html: str, base_url: str = "") -> str:
    try:
        import urllib.parse
        soup = BeautifulSoup(html, 'html.parser')

        candidates = []

        og_img = soup.find('meta', property='og:image')
        if og_img and og_img.get('content'):
            candidates.append(og_img.get('content').strip())

        # 'name' is a reserved kwarg in BeautifulSoup.find() — must use attrs={}
        tw_img = soup.find('meta', attrs={'name': 'twitter:image'})
        if tw_img and tw_img.get('content'):
            candidates.append(tw_img.get('content').strip())

        link_img = soup.find('link', attrs={'rel': 'image_src'})
        if link_img and link_img.get('href'):
            candidates.append(link_img.get('href').strip())

        for img in soup.find_all('img'):
            src = img.get('src')
            if src and not src.startswith('data:'):
                candidates.append(src.strip())

        bad_words = ('logo', 'icon', 'avatar', 'advertisement', 'facebook', 'twitter', 'share', 'banner', 'placeholder')

        for src in candidates:
            if not src:
                continue
            src_lower = src.lower()
            if any(w in src_lower for w in bad_words):
                continue
            # Resolve relative URLs
            if base_url and not src.startswith('http') and not src.startswith('//'):
                src = urllib.parse.urljoin(base_url, src)
            if src.startswith('//'):
                src = 'https:' + src
            if src.startswith('http'):
                return src

    except Exception:
        pass
    return ""


async def download_and_optimize_image(session: AsyncSession, image_url: str, article_title: str = "Desconocido") -> str:
    if not image_url or not isinstance(image_url, str) or not image_url.startswith('http'):
        return ""
    return image_url.strip()


def fetch_url_sync(url: str, timeout: int = 15) -> dict:
    """Thread-safe URL scraper worker using trafilatura and BeautifulSoup fallback."""
    try:
        with Session(impersonate="chrome120") as s:
            response = s.get(url, timeout=timeout)
            if response.status_code != 200:
                return {"text": "", "image_url": ""}
            html = response.text

        image_url = extract_image_url(html, url)

        try:
            import trafilatura
            extracted = trafilatura.extract(html, include_comments=False, include_tables=False)
            if extracted and len(extracted.strip()) > 100:
                return {"text": extracted[:20000], "image_url": image_url}
        except Exception:
            pass

        soup = BeautifulSoup(html, 'html.parser')
        
        # 1. DOM Selective Destruction para remover ruido social/anuncios
        noise_pattern = re.compile(r'(share|social|whatsapp|twitter|facebook|linkedin|email|print|newsletter|ads)', re.I)
        for element in soup(["script", "style", "nav", "footer", "header", "aside"]):
            element.decompose()
        for element in soup.find_all(['div', 'ul', 'li', 'section'], class_=noise_pattern):
            element.decompose()
        for element in soup.find_all(id=noise_pattern):
            element.decompose()

        cleaned_html = str(soup)

        try:
            import trafilatura
            # 2. Ajuste de Trafilatura para priorizar precisión sobre ruido
            extracted = trafilatura.extract(
                cleaned_html, 
                include_comments=False, 
                include_tables=False,
                favor_precision=True
            )
            if extracted and len(extracted.strip()) > 100:
                return {"text": extracted[:20000], "image_url": image_url}
        except Exception:
            pass

        return {"text": soup.get_text(separator=' ', strip=True)[:20000], "image_url": image_url}
    except Exception as e:
        logger.error(f"❌ [fetch_url_sync Error] URL {url}: {e}")
        return {"text": "", "image_url": ""}


def batch_scrape_urls(urls: list, max_workers: int = 5) -> dict:
    """Concurrent scraping of multiple URLs using ThreadPoolExecutor."""
    results = {}
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_url = {executor.submit(fetch_url_sync, url): url for url in urls}
        for future in future_to_url:
            url = future_to_url[future]
            try:
                results[url] = future.result().get("text", "")
            except Exception as e:
                logger.error(f"❌ [ThreadPoolExecutor Error] {url}: {e}")
                results[url] = ""
    return results


class GoogleSearchAgent:
    """Agent for Stage 1: Fast Discovery, Rich Metadata & Deduplication."""
    
    def __init__(self):
        # Use the in-memory singleton — no disk I/O on every instantiation
        from utils.geojson_cache import get_full_map_config
        self.map_config = get_full_map_config()
        if not self.map_config:
            self.map_config = {"mx": {"gl": "MX", "hl": "es", "ceid": "MX:es"}}

    async def search(self, session: AsyncSession, search_params: dict) -> list:
        q_parts = []
        if search_params.get("query"): q_parts.append(search_params["query"])
        if search_params.get("qoption"):
            options = search_params["qoption"].split()
            q_parts.append("(" + " OR ".join(options) + ")" if len(options) > 1 else search_params["qoption"])
        if search_params.get("qexception"):
            for ex in search_params["qexception"].split(): q_parts.append(f"-{ex}")
        if search_params.get("qsite"): q_parts.append(f"site:{search_params['qsite']}")
        if search_params.get("qrangedate"):
            date_val = search_params["qrangedate"].strip()
            if " to " in date_val:
                start_date, end_date = date_val.split(" to ", 1)
                q_parts.append(f"after:{start_date} before:{end_date}")
            else:
                q_parts.append(f"after:{date_val}")
            
        final_query = " ".join(q_parts) or "noticias"
        encoded_query = urllib.parse.quote(final_query)
        
        target_count = min(int(search_params.get("nqueries", 15)), 100)
        buffer_limit = target_count * 3 
        
        # Access the cached configuration safely
        country_key = search_params.get("country", "mx").lower()
        config = self.map_config.get(country_key, self.map_config.get("mx", {}))

        hl = config.get("hl", "es")
        gl = config.get("gl", "MX")
        ceid = config.get("ceid", "MX:es")

        # Construir la URL del RSS de manera totalmente agnóstica
        url = f"https://news.google.com/rss/search?q={encoded_query}&hl={hl}&gl={gl}&ceid={ceid}"
        
        response = await session.get(url, timeout=15)
        logger.info(f"RSS Status: {response.status_code}, URL: {url}")
        if response.status_code == 429:
            raise Exception("GOOGLE_429")
        if response.status_code != 200: 
            logger.error(f"Failed RSS fetch: {response.text[:200]}")
            return []
            
        root = ElementTree.fromstring(response.text)
        articles = []
        seen_titles = set()
        
        for item in root.findall('.//item')[:buffer_limit]:
            title = item.findtext('title', '')
            if not title or title in seen_titles: 
                continue
            seen_titles.add(title)
            
            raw_desc = item.findtext('description', '')
            clean_desc = BeautifulSoup(raw_desc, 'html.parser').get_text(separator=' ', strip=True)
            
            source_tag = item.find('source')
            source_name = source_tag.text if source_tag is not None else item.findtext('source', 'Desconocido')
            # Publisher domain is available as an attribute in the <source> tag — free, no extra request
            source_url = source_tag.get('url', '') if source_tag is not None else ''
            
            try:
                dt_obj = email.utils.parsedate_to_datetime(item.findtext('pubDate'))
                iso_date = dt_obj.strftime("%Y-%m-%d %H:%M:%S")
            except Exception:
                iso_date = item.findtext('pubDate')

            desc_soup = BeautifulSoup(raw_desc, 'html.parser')
            img_tag = desc_soup.find('img')
            rss_image_url = img_tag.get('src') if img_tag else None

            articles.append({
                "guid": item.findtext('guid'),
                "title": title,
                "url": item.findtext('link'),
                "date": iso_date,
                "source": source_name,
                "source_url": source_url,
                "summary": clean_desc,
                "_temp_image_url": rss_image_url
            })
        return articles


class UrlResolverAgent:
    @retry(wait=wait_exponential(multiplier=1, min=2, max=10), stop=stop_after_attempt(3))
    async def resolve(self, session: AsyncSession, url: str) -> str:
        browser = None
        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
                context = await browser.new_context(viewport={"width": 1280, "height": 720})
                page = await context.new_page()
                await page.goto(url, timeout=30000, wait_until="domcontentloaded")
                
                try: await page.wait_for_url(lambda u: "news.google.com" not in u and "google.com" not in u, timeout=10000)
                except Exception: await page.wait_for_timeout(4000)
                
                final_url = page.url
                await browser.close()
                return final_url
        except Exception as e:
            if browser:
                try: await browser.close()
                except: pass
            raise e

class SiteScraperAgent:
    """Scrapes article text concurrently using ThreadPoolExecutor and trafilatura/BeautifulSoup."""
    def __init__(self, max_workers: int = 5):
        self.executor = ThreadPoolExecutor(max_workers=max_workers)

    @retry(wait=wait_exponential(multiplier=1, min=2, max=10), stop=stop_after_attempt(3))
    async def scrape(self, session: AsyncSession, url: str) -> dict:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self.executor, fetch_url_sync, url)

class NLPAgent:
    def __init__(self):
        default_ollama = "http://localhost:11434/api/generate"
        self.ollama_url = os.environ.get("OLLAMA_API_URL", os.environ.get("OLLAMA_URL", default_ollama))
        self.model_name = os.environ.get("OLLAMA_MODEL", "llama3.1")
        self.compressor = None
        self._init_compressor()

    def _init_compressor(self):
        """Initialize llmlingua PromptCompressor. Fails silently if unavailable."""
        try:
            from llmlingua import PromptCompressor
            self.compressor = PromptCompressor(
                model_name="microsoft/llmlingua-2-bert-base-multilingual-cased-meetingbank",
                use_llmlingua2=True,
                device_map="cpu"
            )
            logger.info("✅ [NLPAgent] llmlingua PromptCompressor initialized.")
        except Exception as e:
            logger.warning(f"⚠️ [NLPAgent] llmlingua not available, sending uncompressed text. Detail: {e}")
            self.compressor = None

    def _compress_text(self, text: str) -> str:
        """Compress text using llmlingua. Returns original text on failure."""
        if not self.compressor or not text:
            return text
        try:
            result = self.compressor.compress_prompt(
                [text],
                rate=0.5,
                force_tokens=['\n', '.', ',', '?', '!']
            )
            compressed = result.get("compressed_prompt", text)
            original_len = len(text)
            compressed_len = len(compressed)
            logger.info(f"📦 [llmlingua] Compressed {original_len} → {compressed_len} chars ({100 - int(compressed_len/original_len*100)}% reduction)")
            return compressed
        except Exception as e:
            logger.warning(f"⚠️ [llmlingua] Compression failed, using raw text. Detail: {e}")
            return text

    @retry(wait=wait_exponential(multiplier=1, min=2, max=10), stop=stop_after_attempt(3))
    async def extract_states(self, session: AsyncSession, text: str, title: str = "", country: str = "mx") -> list:
        if not title.strip() and not text.strip(): 
            return []

        # 3. Aumentamos el corte de 1800 a 3000 caracteres antes de la compresión
        compressed_text = self._compress_text(text[:3000])

        # ── In-memory lookups — no disk I/O ───────────────────────────────
        try:
            config = get_map_config(country)
            valid_regions = get_valid_regions(country)
            if not valid_regions:
                logger.error(f"❌ [NLPAgent] No valid regions found for country '{country}'")
                return []
            valid_regions_str = ", ".join(valid_regions)
            country_name = config.get("country_name", country)
            llm_hints = config.get("llm_hints", "")
        except Exception as e:
            logger.error(f"❌ [NLPAgent] Failed to load config for {country}: {e}")
            return []

        prompt = (
            f"You are a strict geographic entity extractor. Analyze the text and extract ONLY the {country_name} regions that are the MAIN FOCUS of the story.\n\n"
            "CRITICAL RULES:\n"
            f"1. EXACT VOCABULARY: Output MUST perfectly match items from this exact list: [{valid_regions_str}].\n"
            "2. TITLE PRIORITY: The headline/title is the PRIMARY focus of the news. If regions or cities are mentioned in the Title, they take precedence over incidental places mentioned in the body.\n"
            f"3. ALIASES & RULES: {llm_hints}\n"
            "4. CITY INFERENCE: If a known city is the focus, output its parent region from the list.\n"
            "5. NO HALLUCINATIONS: If no region is the primary focus, return an empty array.\n"
            "6. FORMAT: Return ONLY valid JSON: {\"locations\": [\"Region1\"]}.\n\n"
            f"Title: {title}\nText: {compressed_text}"
        )

        try:
            payload = {"model": self.model_name, "prompt": prompt, "stream": False, "format": "json", "options": {"temperature": 0.0, "num_predict": 150}}
            try:
                if session:
                    response = await session.post(self.ollama_url, json=payload, timeout=120)
                else:
                    async with AsyncSession() as local_session:
                        response = await local_session.post(self.ollama_url, json=payload, timeout=120)
            except Exception as conn_err:
                if "host.docker.internal" in self.ollama_url:
                    self.ollama_url = self.ollama_url.replace("host.docker.internal", "localhost")
                    if session:
                        response = await session.post(self.ollama_url, json=payload, timeout=120)
                    else:
                        async with AsyncSession() as local_session:
                            response = await local_session.post(self.ollama_url, json=payload, timeout=120)
                else:
                    raise conn_err
            if response.status_code == 200:
                raw_response = response.json().get('response', '').strip()
                clean_json_str = raw_response.replace("```json", "").replace("```", "").strip()
                json_match = re.search(r'\{.*\}', clean_json_str, re.DOTALL)
                if json_match: clean_json_str = json_match.group(0)
                
                estados = json.loads(clean_json_str).get("locations", [])
                return estados if isinstance(estados, list) else []
            return []
        except Exception as e:
            logger.error(f"❌ [NLPAgent Error] en noticia '{title[:50]}...'. Detalle: {e}")
            raise e

async def resolve_url_curl(session: AsyncSession, url: str) -> str:
    try:
        resp = await session.get(url, allow_redirects=True, timeout=10)
        if resp.url:
            return resp.url
    except Exception as e:
        logger.error(f"⚠️ [resolve_url_curl Error] {url}: {e}")
    return url

async def resolve_url_fast(session: AsyncSession, url: str) -> str:
    """Fast Google News URL resolver without Playwright.

    Strategy:
      1. If not a Google News URL, return as-is.
      2. Try a GET with full browser headers — sometimes Google follows through.
      3. Return original URL if nothing else works (caller handles Playwright gate).
    """
    if "news.google.com" not in url:
        return url

    try:
        headers = {
            "Referer": "https://news.google.com/",
            "Accept-Language": "es-MX,es;q=0.9,en;q=0.8",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Cache-Control": "no-cache",
        }
        resp = await session.get(url, allow_redirects=True, timeout=10, headers=headers)
        final = str(resp.url)
        if "news.google.com" not in final and resp.status_code == 200:
            logger.info(f"✅ [resolve_url_fast] Curl resolvió: {final[:80]}")
            return final
    except Exception as e:
        logger.debug(f"⚙️ [resolve_url_fast] Curl falló: {e}")

    # Nothing worked — return original so caller can try Playwright
    return url

async def resolve_url_combined(resolver_agent: UrlResolverAgent, session: AsyncSession, url: str) -> str:
    resolved = url
    try:
        resp = await session.get(url, allow_redirects=True, timeout=10)
        if resp.status_code == 429:
            raise Exception("GOOGLE_429")
        resolved = resp.url
    except Exception as e:
        if str(e) == "GOOGLE_429": raise e
        logger.error(f"⚠️ [resolve_url_curl Error] {url}: {e}")
        
    if "news.google.com" in resolved or "google.com/url" in resolved:
        try:
            resolved = await resolver_agent.resolve(session, url)
        except Exception as e:
            logger.error(f"⚠️ [playwright fallback Error] {url}: {e}")
    return resolved


async def scrape_with_playwright(url: str) -> tuple:
    """Fallback extraction using Playwright to render JavaScript challenges."""
    browser = None
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
            context = await browser.new_context(viewport={"width": 1280, "height": 720})
            page = await context.new_page()
            await page.goto(url, timeout=30000, wait_until="domcontentloaded")
            await page.wait_for_timeout(3000)
            html = await page.content()
            await browser.close()
            
            image_url = extract_image_url(html, url)
            text = ""
            try:
                import trafilatura
                extracted = trafilatura.extract(html, include_comments=False, include_tables=False)
                if extracted and len(extracted.strip()) > 100:
                    text = extracted[:20000]
            except Exception:
                pass
            if not text:
                soup = BeautifulSoup(html, 'html.parser')
                for element in soup(["script", "style", "nav", "footer", "header", "aside"]):
                    element.extract()
                text = soup.get_text(separator=' ', strip=True)[:20000]
            return text, image_url
    except Exception as e:
        logger.warning(f"⚠️ [Playwright Fallback Failed] ({url}): {e}")
        if browser:
            try:
                await browser.close()
            except Exception:
                pass
        return "", ""


class OrchestratorAgent:
    def __init__(self):
        self.search_agent = GoogleSearchAgent()
        self.resolver = UrlResolverAgent()
        self.scraper = SiteScraperAgent(max_workers=5)
        self._nlp = None
        self.db = None
        self.db_lock = asyncio.Lock()
        self.history_db = None
        self.history_lock = asyncio.Lock()
        self.blocked_by_google = False
        
        self.playwright_semaphore = asyncio.Semaphore(1)
        self.scraper_semaphore = asyncio.Semaphore(10)
        self.nlp_semaphore = asyncio.Semaphore(1)

    @property
    def nlp(self):
        if self._nlp is None:
            self._nlp = NLPAgent()
        return self._nlp

    async def init_cache(self):
        db_path = os.path.join(BASE_DIR, "cache.db")
        
        # Nos aseguramos de que el directorio contenedor exista físicamente
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        
        self.db = await aiosqlite.connect(db_path, timeout=30.0)
        try:
            await self.db.execute("PRAGMA journal_mode=WAL")
            await self.db.execute("PRAGMA synchronous=NORMAL")
        except Exception:
            pass
        
        await self.db.execute("""
            CREATE TABLE IF NOT EXISTS articles_cache (
                url TEXT PRIMARY KEY, 
                states_json TEXT, 
                real_url TEXT,
                image_path TEXT,
                scraped_text TEXT,
                title TEXT,
                source TEXT,
                date TEXT,
                summary TEXT,
                query TEXT,
                ui_selected INTEGER DEFAULT 0
            )
        """)
        try:
            await self.db.execute("ALTER TABLE articles_cache ADD COLUMN ui_selected INTEGER DEFAULT 0")
        except Exception:
            pass
        await self.db.commit()

    async def init_history_db(self):
        try:
            db_url = os.environ.get('DATABASE_URL')
            if not db_url:
                raise ValueError("DATABASE_URL is not configured")
            try:
                self.history_db = await asyncpg.create_pool(db_url)
            except Exception as pool_err:
                # Fallback to localhost:5433 if postgres container hostname cannot be resolved on host
                if db_url and '@postgres:' in db_url:
                    db_url = db_url.replace('@postgres:5432', '@localhost:5433')
                    self.history_db = await asyncpg.create_pool(db_url)
                else:
                    raise pool_err
            
            async with self.history_db.acquire() as conn:
                await conn.execute("""
                    CREATE TABLE IF NOT EXISTS chat_history (
                    id SERIAL PRIMARY KEY,
                    execution_id VARCHAR(50) NOT NULL,
                    role VARCHAR(20) NOT NULL,
                    encrypted_content TEXT NOT NULL,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                
                CREATE TABLE IF NOT EXISTS search_executions (
                        execution_id TEXT PRIMARY KEY,
                        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        search_term TEXT,
                        filters JSONB,
                        status TEXT DEFAULT 'COMPLETED'
                    )
                """)
                await conn.execute("ALTER TABLE search_executions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'COMPLETED';")
                await conn.execute("ALTER TABLE search_executions ADD COLUMN IF NOT EXISTS end_time TIMESTAMP;")
                await conn.execute("ALTER TABLE search_executions ADD COLUMN IF NOT EXISTS scraped_at TIMESTAMP;")
                
                await conn.execute("""
                    CREATE TABLE IF NOT EXISTS articles (
                        article_id TEXT,
                        execution_id TEXT,
                        title TEXT,
                        url TEXT,
                        date TEXT,
                        source TEXT,
                        geodata JSONB,
                        image_url TEXT,
                        content_snippet TEXT,
                        PRIMARY KEY (article_id, execution_id),
                        FOREIGN KEY(execution_id) REFERENCES search_executions(execution_id) ON DELETE CASCADE
                    )
                """)
                await conn.execute("ALTER TABLE articles ADD COLUMN IF NOT EXISTS image_url TEXT;")
                await conn.execute("ALTER TABLE articles ADD COLUMN IF NOT EXISTS content_snippet TEXT;")
        except Exception as e:
            logger.error(f"⚠️ [Postgres Init Error]: {e}")
            raise

    async def close(self):
        if self.db: await self.db.close()
        if self.history_db: await self.history_db.close()

    async def fetch_discovery(self, search_params, execution_id=None):
        if not self.db:
            await self.init_cache()
            
        existing_titles = set()
        if execution_id:
            update_progress(execution_id, 10, "Fetching discovery (10%)...")
            if not self.history_db: await self.init_history_db()
            async with self.history_db.acquire() as conn:
                rows = await conn.fetch("SELECT title FROM articles WHERE execution_id = $1", execution_id)
                existing_titles = {r['title'] for r in rows}
            
        query_key = search_params.get("query", "")
        self.blocked_by_google = False
        
        async with AsyncSession(impersonate="chrome120") as session:
            # Stage 1: Discovery via search RSS
            try:
                articles = await self.search_agent.search(session, search_params)
            except Exception as e:
                if "GOOGLE_429" in str(e):
                    self.blocked_by_google = True
                    articles = []
                else:
                    raise e
                    
            # Skip articles already scraped (Resuming Phase 1)
            articles = [a for a in articles if a['title'] not in existing_titles]
            
            if execution_id:
                update_progress(execution_id, 40, f"Extracting text from {len(articles)} articles...")
            
            # Concurrently resolve target HTML, download/optimize images, extract text and cache
            async def process_article(a):
                if getattr(self, 'blocked_by_google', False):
                    return
                title = a.get('title', 'Desconocido')
                try:
                    # Randomized jitter to prevent anti-bot WAF flagging
                    await asyncio.sleep(random.uniform(0.1, 0.6))
                    
                    # Clean temp image URL from RSS to ignore it as requested
                    a.pop('_temp_image_url', None)
                    
                    # Resolve real redirect URL
                    # Step 1: Fast resolver — tries browser-headers curl
                    real_url = await resolve_url_fast(session, a['url'])

                    # Step 2: Only invoke Playwright if still stuck on news.google.com
                    if "news.google.com" in real_url:
                        logger.info(f"🖥️ [resolve] Playwright como último recurso para '{title}'...")
                        async with self.playwright_semaphore:
                            try:
                                real_url = await self.resolver.resolve(session, a['url'])
                            except Exception as pw_err:
                                logger.warning(f"⚠️ [resolve Playwright failed] '{title}': {pw_err}")
                                real_url = a['url']

                    a['real_url'] = real_url

                    
                    # Fetch target HTML with retries & backoff
                    html = ""
                    for attempt in range(1, 4):
                        try:
                            response = await session.get(real_url, timeout=15)
                            if response.status_code == 429:
                                raise Exception("GOOGLE_429")
                            if response.status_code == 200:
                                html = response.text
                                break
                            elif attempt < 3:
                                await asyncio.sleep(0.5 * attempt)
                        except Exception as req_err:
                            if attempt < 3:
                                await asyncio.sleep(0.5 * attempt)
                            else:
                                logger.warning(f"⚠️ [Fetch HTML Retry Failed] '{title}' ({real_url}): {req_err}")
                    
                    # Extract article text using BeautifulSoup or trafilatura
                    text = ""
                    if html:
                        soup = BeautifulSoup(html, 'html.parser')
                        
                        # 1. DOM Selective Destruction
                        noise_pattern = re.compile(r'(share|social|whatsapp|twitter|facebook|linkedin|email|print|newsletter|ads)', re.I)
                        for element in soup(["script", "style", "nav", "footer", "header", "aside"]):
                            element.decompose()
                        for element in soup.find_all(['div', 'ul', 'li', 'section'], class_=noise_pattern):
                            element.decompose()
                        for element in soup.find_all(id=noise_pattern):
                            element.decompose()

                        cleaned_html = str(soup)

                        try:
                            import trafilatura
                            extracted = trafilatura.extract(
                                cleaned_html, 
                                include_comments=False, 
                                include_tables=False,
                                favor_precision=True
                            )
                            if extracted and len(extracted.strip()) > 100:
                                text = extracted[:20000]
                        except Exception:
                            pass
                        
                        if not text:
                            text = soup.get_text(separator=' ', strip=True)[:20000]
                    
                    image_url = extract_image_url(html, real_url) if html else ""
                    
                    # Playwright fallback if text fails minimum length check (>200 chars)
                    if len(text.strip()) <= 200:
                        logger.info(f"🔄 [WAF/Empty Text Trigger] Using Playwright fallback for '{title}'...")
                        async with self.playwright_semaphore:
                            pw_text, pw_image = await scrape_with_playwright(real_url)
                        if len(pw_text.strip()) > len(text.strip()):
                            text = pw_text
                        if not image_url and pw_image:
                            image_url = pw_image

                    
                    # Keep raw remote image URL (no local filesystem download)
                    remote_img = image_url or a.get("_temp_image_url") or ""
                    a['image'] = remote_img.strip() if remote_img else None
                    a['image_url'] = a['image']
                    a['states'] = []
                    a['scraped_text'] = text
                            
                    # Cache in DB (original url is key)
                    async with self.db_lock:
                        await self.db.execute(
                            "INSERT OR REPLACE INTO articles_cache (url, real_url, states_json, image_path, scraped_text, title, source, date, summary, query, ui_selected) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
                            (a['url'], real_url, json.dumps([]), a['image'], text, a['title'], a['source'], a['date'], a['summary'], query_key)
                        )
                        await self.db.commit()
                except Exception as e:
                    logger.warning(f"⚠️ [process_article Error] Omitiendo noticia '{title}'. Razón: {e}")
                    a['real_url'] = a.get('real_url', a['url'])
                    a['image'] = a.get("_temp_image_url") or None
                    a['image_url'] = a['image']
                    a['states'] = []
                    a['scraped_text'] = ""
                    try:
                        async with self.db_lock:
                            await self.db.execute(
                                "INSERT OR REPLACE INTO articles_cache (url, real_url, states_json, image_path, scraped_text, title, source, date, summary, query, ui_selected) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
                                (a['url'], a.get('real_url', a['url']), json.dumps([]), None, "", a.get('title', ''), a.get('source', ''), a.get('date', ''), a.get('summary', ''), query_key)
                            )
                            await self.db.commit()
                    except Exception:
                        pass
            
            tasks = [process_article(a) for a in articles]
            await asyncio.gather(*tasks, return_exceptions=True)
            
            target_count = min(int(search_params.get("nqueries", 15)), 100)
            
            # Enforce strict quota: filter pool for successful extractions (>200 chars)
            successful_articles = [a for a in articles if len(a.get('scraped_text', '').strip()) > 200]
            
            # Deduplicate by resolved real_url BEFORE slicing
            unique_successful = []
            seen_urls = set()
            for a in successful_articles:
                r_url = a.get('real_url') or a.get('url') or ""
                if r_url not in seen_urls:
                    seen_urls.add(r_url)
                    unique_successful.append(a)
            
            logger.info(f"📊 [Quota] Buffer={len(articles)} → Valid={len(successful_articles)} → Unique={len(unique_successful)} → Returning={min(len(unique_successful), target_count)} (requested={target_count})")
            
            # Trim to exact user-requested limit
            final_articles = unique_successful[:target_count]
            
            # Lock the exact finalized UI selection in cache.db for Phase 2 synchronization
            async with self.db_lock:
                await self.db.execute("UPDATE articles_cache SET ui_selected = 0 WHERE query = ?", (query_key,))
                for rank, a in enumerate(final_articles, start=1):
                    await self.db.execute("UPDATE articles_cache SET ui_selected = ? WHERE url = ?", (rank, a['url']))
                await self.db.commit()
            
            if execution_id:
                update_progress(execution_id, 100, "Extraction complete.")
                
            # History Persistence (Phase 1)
            if not execution_id:
                execution_id = str(uuid.uuid4())
            filters_json = json.dumps(search_params)
            
            if not self.history_db:
                await self.init_history_db()
                
            async with self.history_lock:
                async with self.history_db.acquire() as conn:
                    async with conn.transaction():
                        # Update status and end_time if already exists, else insert
                        final_status = 'PAUSED_BLOCKED' if self.blocked_by_google else 'SCRAPED'
                        await conn.execute(
                            """
                            INSERT INTO search_executions (execution_id, search_term, filters, status, end_time, scraped_at) 
                            VALUES ($1, $2, $3::jsonb, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                            ON CONFLICT (execution_id) DO UPDATE SET status = $4, end_time = CURRENT_TIMESTAMP, scraped_at = CURRENT_TIMESTAMP
                            """,
                            execution_id, query_key, filters_json, final_status
                        )
                        
                        for a in final_articles:
                            r_url = a.get("real_url") or a.get("url") or ""
                            article_id = hashlib.md5(r_url.encode("utf-8")).hexdigest()
                            raw_img = a.get("image_url") or a.get("image") or ""
                            # Store up to 3000 chars of the text for Chatbot context
                            snippet = a.get("scraped_text", "")[:3000]
                            await conn.execute(
                                """
                                INSERT INTO articles (article_id, execution_id, title, url, date, source, geodata, image_url, content_snippet) 
                                VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8) 
                                ON CONFLICT (article_id, execution_id) DO UPDATE SET image_url = EXCLUDED.image_url, content_snippet = EXCLUDED.content_snippet
                                """,
                                article_id, execution_id, a.get("title", ""), r_url, a.get("date", ""), a.get("source", ""), raw_img, snippet
                            )
                            
            # Clean internal scraped_text from ALL processed articles (prevent memory/payload leak)
            for a in articles:
                a.pop('scraped_text', None)
                
            return execution_id, final_articles

    async def map_stream(self, execution_id, country="mx"):
        if not self.db:
            await self.init_cache()
        if not self.history_db:
            await self.init_history_db()
            
        start_time = time.time()
        
        # Load articles for this execution that haven't been geocoded yet
        async with self.history_db.acquire() as conn:
            rows = await conn.fetch("SELECT article_id, execution_id, url, title, date, source, image_url, content_snippet FROM articles WHERE execution_id = $1 AND geodata IS NULL", execution_id)
            
        articles = [dict(r) for r in rows]
        total_target = len(articles)
        
        # We no longer need sqlite scraped_text since we have content_snippet in Postgres
        for a in articles:
            a['scraped_text'] = a.get('content_snippet', '')
                
        current = 0
        discarded = 0
        
        yield {
            "type": "update",
            "message": f"Iniciando fase 2 offline para {total_target} artículos...",
            "phase": "inference",
            "current": current,
            "target": total_target,
            "discarded": discarded,
            "elapsed_time": round(time.time() - start_time, 2),
            "text": "Starting offline AI inference"
        }
        
        try:
            from utils.llm_batch import process_articles_batch
            batch_size = 5
            for i in range(0, len(articles), batch_size):
                batch = articles[i:i+batch_size]
                
                # Map scraped_text to content_snippet for the batch processor
                for a in batch:
                    a['content_snippet'] = a.get('scraped_text', '')
                
                elapsed = time.time() - start_time
                yield {
                    "type": "update",
                    "message": f"Analizando lote de {len(batch)} artículos...",
                    "phase": "inference",
                    "current": current,
                    "target": total_target,
                    "discarded": discarded,
                    "elapsed_time": round(elapsed, 2),
                    "text": f"Inference for batch starting at {i}"
                }
                
                try:
                    await process_articles_batch(self.history_db, batch, country)
                    
                    for a in batch:
                        # Set empty states for backward compatibility with UI if needed
                        a["states"] = []
                        
                        current += 1
                        yield {
                            "type": "article",
                            "data": a,
                            "phase": "inference",
                            "current": current,
                            "target": total_target,
                            "discarded": discarded,
                            "elapsed_time": round(time.time() - start_time, 2),
                            "text": f"Yielded article from batch"
                        }
                except Exception as e:
                    import logging
                    logging.error(f"❌ [map_stream offline batch Error]: {e}")
                    for a in batch:
                        async with self.history_db.acquire() as conn:
                            await conn.execute("UPDATE articles SET geodata = $1::jsonb WHERE article_id = $2", json.dumps([]), a['article_id'])
                        current += 1
                        yield {
                            "type": "article",
                            "data": a,
                            "phase": "inference",
                            "current": current,
                            "target": total_target,
                            "discarded": discarded,
                            "elapsed_time": round(time.time() - start_time, 2),
                            "text": f"Yielded article with fallback from batch"
                        }
                        
            async with self.history_db.acquire() as conn:
                await conn.execute("UPDATE search_executions SET status = 'COMPLETED', end_time = CURRENT_TIMESTAMP WHERE execution_id = $1", execution_id)
                
        except Exception as e:
            async with self.history_db.acquire() as conn:
                await conn.execute("UPDATE search_executions SET status = 'PARTIALLY_ANALYZED', end_time = CURRENT_TIMESTAMP WHERE execution_id = $1", execution_id)
            raise e
            
        elapsed = time.time() - start_time
        yield {
            "type": "update",
            "message": "All processing complete!",
            "phase": "inference",
            "current": current,
            "target": total_target,
            "discarded": discarded,
            "elapsed_time": round(elapsed, 2),
            "text": "Complete"
        }

    async def get_history_list(self):
        if not self.history_db:
            await self.init_history_db()
        
        async with self.history_db.acquire() as conn:
            records = await conn.fetch("""
                SELECT 
                    se.execution_id, 
                    se.timestamp, 
                    se.end_time,
                    se.scraped_at,
                    se.search_term, 
                    se.filters, 
                    se.status,
                    COUNT(a.article_id) as total_articles 
                FROM search_executions se 
                LEFT JOIN articles a ON se.execution_id = a.execution_id 
                GROUP BY se.execution_id, se.timestamp, se.end_time, se.scraped_at, se.search_term, se.filters, se.status 
                ORDER BY COALESCE(se.scraped_at, se.timestamp) DESC
            """)
            return [dict(r) for r in records]

    async def get_history_detail(self, execution_id):
        if not self.history_db:
            await self.init_history_db()
            
        async with self.history_db.acquire() as conn:
            exec_record = await conn.fetchrow(
                "SELECT * FROM search_executions WHERE execution_id = $1", 
                execution_id
            )
            if not exec_record:
                return None
                
            articles = await conn.fetch(
                "SELECT * FROM articles WHERE execution_id = $1", 
                execution_id
            )
            
            return {
                "execution": dict(exec_record),
                "articles": [dict(a) for a in articles]
            }

    async def get_aggregated_history(self, execution_ids):
        if not self.history_db:
            await self.init_history_db()
            
        async with self.history_db.acquire() as conn:
            articles = await conn.fetch("""
                SELECT DISTINCT ON (a.article_id) 
                    a.*, 
                    se.search_term as origin_search_term
                FROM articles a
                JOIN search_executions se ON a.execution_id = se.execution_id
                WHERE a.execution_id = ANY($1)
            """, execution_ids)
            
            executions = await conn.fetch("""
                SELECT * FROM search_executions WHERE execution_id = ANY($1)
            """, execution_ids)
            
            return {
                "executions": [dict(e) for e in executions],
                "articles": [dict(a) for a in articles]
            }