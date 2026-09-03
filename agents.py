import os
import re
import json
import time
import random
import asyncio
import logging
import hashlib
from PIL import Image
from zoneinfo import ZoneInfo
import urllib.parse
import email.utils
from datetime import datetime
from xml.etree import ElementTree
from concurrent.futures import ThreadPoolExecutor

import aiosqlite
from bs4 import BeautifulSoup
from tenacity import retry, wait_exponential, stop_after_attempt

from curl_cffi.requests import AsyncSession, Session
from playwright.async_api import async_playwright

# Asegurar ruta absoluta para la carpeta logs
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_DIR = os.path.join(BASE_DIR, "logs")
if not os.path.exists(LOG_DIR):
    os.makedirs(LOG_DIR)

# Define tu zona horaria local
LOCAL_TZ = ZoneInfo("America/Merida")

log_filename = f"logs/scraping_{datetime.now(LOCAL_TZ).strftime('%Y-%m-%d')}.log"

class TimezoneFormatter(logging.Formatter):
    def formatTime(self, record, datefmt=None):
        dt = datetime.fromtimestamp(record.created, tz=LOCAL_TZ)
        if datefmt:
            return dt.strftime(datefmt)
        return dt.strftime('%Y-%m-%d %H:%M:%S,%f')[:-3]

# Configuración directa sobre el root logger para evitar conflictos con Flask
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Limpiar handlers previos si existieran
if logger.hasHandlers():
    logger.handlers.clear()

formatter = TimezoneFormatter('%(asctime)s [%(levelname)s] %(message)s')

file_handler = logging.FileHandler(log_filename, encoding='utf-8')
file_handler.setFormatter(formatter)
logger.addHandler(file_handler)

stream_handler = logging.StreamHandler()
stream_handler.setFormatter(formatter)
logger.addHandler(stream_handler)

logger = logging.getLogger(__name__)


def extract_image_url(html: str) -> str:
    try:
        soup = BeautifulSoup(html, 'html.parser')
        og_img = soup.find('meta', property='og:image')
        if og_img and og_img.get('content'):
            return og_img.get('content').strip()
        tw_img = soup.find('meta', name='twitter:image')
        if tw_img and tw_img.get('content'):
            return tw_img.get('content').strip()
        for img in soup.find_all('img'):
            src = img.get('src')
            if src and src.startswith('http') and not any(x in src.lower() for x in ['logo', 'icon', 'avatar', 'ad', 'advertisement', 'pixel']):
                return src.strip()
    except Exception:
        pass
    return ""


async def download_and_optimize_image(session: AsyncSession, image_url: str, article_title: str = "Desconocido") -> str:
    if not image_url or not isinstance(image_url, str) or not image_url.startswith('http'):
        logger.warning(f"⚠️ El artículo '{article_title}' no incluye una URL de imagen válida en el RSS/HTML.")
        return ""
    try:
        images_dir = os.path.join(BASE_DIR, "static", "news_images")
        os.makedirs(images_dir, exist_ok=True)
        
        url_hash = hashlib.md5(image_url.encode('utf-8')).hexdigest()
        filename = f"{url_hash}.webp"
        filepath = os.path.join(images_dir, filename)
        relative_path = f"/static/news_images/{filename}"
        
        if os.path.exists(filepath):
            return relative_path

        response = None
        for attempt in range(1, 4):
            try:
                response = await session.get(image_url, timeout=26)
                if response.status_code == 200:
                    break
                elif attempt < 3:
                    await asyncio.sleep(0.4 * attempt)
            except Exception as img_err:
                if attempt < 3:
                    await asyncio.sleep(0.4 * attempt)
                else:
                    logger.warning(f"⚠️ [Image Download Retry Failed] '{article_title}' ({image_url}): {img_err}")
                    return ""

        if not response or response.status_code != 200:
            return ""
            
        from io import BytesIO
        img = Image.open(BytesIO(response.content))
        
        width, height = img.size
        if width > 800:
            new_width = 800
            new_height = int((height * 800) / width)
            img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
            
        if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
            img.save(filepath, "WEBP", quality=80)
        else:
            img = img.convert("RGB")
            img.save(filepath, "WEBP", quality=80)
            
        return relative_path
    except Exception as e:
        logger.error(f"❌ Error descargando imagen para '{article_title}' ({image_url}): {e}")
        return ""


def fetch_url_sync(url: str, timeout: int = 15) -> dict:
    """Thread-safe URL scraper worker using trafilatura and BeautifulSoup fallback."""
    try:
        with Session(impersonate="chrome120") as s:
            response = s.get(url, timeout=timeout)
            if response.status_code != 200:
                return {"text": "", "image_url": ""}
            html = response.text

        image_url = extract_image_url(html)

        try:
            import trafilatura
            extracted = trafilatura.extract(html, include_comments=False, include_tables=False)
            if extracted and len(extracted.strip()) > 100:
                return {"text": extracted[:20000], "image_url": image_url}
        except Exception:
            pass

        soup = BeautifulSoup(html, 'html.parser')
        for element in soup(["script", "style", "nav", "footer", "header", "aside"]):
            element.extract()
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
        # Cache configuration during initialization to avoid blocking disk I/O on every search
        config_path = os.path.join(BASE_DIR, "static", "maps", "map_config.json")
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                self.map_config = json.load(f)
        except Exception as e:
            logger.error(f"Failed to load map_config.json: {e}")
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
        
        try:
            response = await session.get(url, timeout=15)
            if response.status_code != 200: return []
                
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
                    "summary": clean_desc,
                    "_temp_image_url": rss_image_url
                })
            return articles
        except Exception as e:
            logger.error(f"❌ [GoogleSearch] Error: {e}")
            return []

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
        self.ollama_url = "http://host.docker.internal:11434/api/generate"
        self.model_name = "llama3.1"
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

        compressed_text = self._compress_text(text[:1800])

        config_path = os.path.join(BASE_DIR, "static", "maps", "map_config.json")
        geojson_path = os.path.join(BASE_DIR, "static", "maps", f"{country}_states.geojson")
        
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                config = json.load(f).get(country, {})
            with open(geojson_path, "r", encoding="utf-8") as f:
                geojson_data = json.load(f)
            
            valid_regions = [feat["properties"]["state_name"] for feat in geojson_data.get("features", [])]
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
            f"2. ALIASES & RULES: {llm_hints}\n"
            "3. CITY INFERENCE: If a known city is the focus, output its parent region from the list.\n"
            "4. NO HALLUCINATIONS: If no region is the primary focus, return an empty array.\n"
            "5. FORMAT: Return ONLY valid JSON: {\"locations\": [\"Region1\"]}.\n\n"
            f"Title: {title}\nText: {compressed_text}"
        )

        try:
            payload = {"model": self.model_name, "prompt": prompt, "stream": False, "format": "json", "options": {"temperature": 0.0, "num_predict": 150}}
            if session:
                response = await session.post(self.ollama_url, json=payload, timeout=120)
            else:
                async with AsyncSession() as local_session:
                    response = await local_session.post(self.ollama_url, json=payload, timeout=120)
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

async def resolve_url_combined(resolver_agent: UrlResolverAgent, session: AsyncSession, url: str) -> str:
    resolved = url
    try:
        resp = await session.get(url, allow_redirects=True, timeout=10)
        resolved = resp.url
    except Exception as e:
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
            
            image_url = extract_image_url(html)
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
        self.nlp = NLPAgent()
        self.db = None
        self.db_lock = asyncio.Lock()
        
        self.playwright_semaphore = asyncio.Semaphore(1)
        self.scraper_semaphore = asyncio.Semaphore(10)
        self.nlp_semaphore = asyncio.Semaphore(1)

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

    async def close(self):
        if self.db: await self.db.close()

    async def fetch_discovery(self, search_params):
        if not self.db:
            await self.init_cache()
            
        query_key = search_params.get("query", "")
        async with AsyncSession(impersonate="chrome120") as session:
            # Stage 1: Discovery via search RSS
            articles = await self.search_agent.search(session, search_params)
            
            # Concurrently resolve target HTML, download/optimize images, extract text and cache
            async def process_article(a):
                title = a.get('title', 'Desconocido')
                try:
                    # Randomized jitter to prevent anti-bot WAF flagging
                    await asyncio.sleep(random.uniform(0.1, 0.6))
                    
                    # Clean temp image URL from RSS to ignore it as requested
                    a.pop('_temp_image_url', None)
                    
                    # Resolve real redirect URL
                    real_url = await resolve_url_combined(self.resolver, session, a['url'])
                    a['real_url'] = real_url
                    
                    # Fetch target HTML with retries & backoff
                    html = ""
                    for attempt in range(1, 4):
                        try:
                            response = await session.get(real_url, timeout=15)
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
                    
                    image_url = extract_image_url(html) if html else ""
                    
                    # Playwright fallback if text fails minimum length check (>200 chars)
                    if len(text.strip()) <= 200:
                        logger.info(f"🔄 [WAF/Empty Text Trigger] Using Playwright fallback for '{title}'...")
                        pw_text, pw_image = await scrape_with_playwright(real_url)
                        if len(pw_text.strip()) > len(text.strip()):
                            text = pw_text
                        if not image_url and pw_image:
                            image_url = pw_image
                    
                    # Download and optimize image
                    local_img = await download_and_optimize_image(session, image_url, article_title=title)
                    a['image'] = local_img if local_img else None
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
                    a['image'] = None
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
            
            logger.info(f"📊 [Quota] Buffer={len(articles)} → Valid={len(successful_articles)} → Returning={min(len(successful_articles), target_count)} (requested={target_count})")
            
            # Trim to exact user-requested limit
            final_articles = successful_articles[:target_count]
            
            # Lock the exact finalized UI selection in cache.db for Phase 2 synchronization
            async with self.db_lock:
                await self.db.execute("UPDATE articles_cache SET ui_selected = 0 WHERE query = ?", (query_key,))
                for rank, a in enumerate(final_articles, start=1):
                    await self.db.execute("UPDATE articles_cache SET ui_selected = ? WHERE url = ?", (rank, a['url']))
                await self.db.commit()
            
            # Clean internal scraped_text from ALL processed articles (prevent memory/payload leak)
            for a in articles:
                a.pop('scraped_text', None)
                
            return final_articles

    async def map_stream(self, search_params):
        if not self.db:
            await self.init_cache()
            
        target_count = min(int(search_params.get("nqueries", 15)), 100)
        query_key = search_params.get("query", "")
        start_time = time.time()
        
        # Load strictly the exact same articles that were finalized for the UI in Phase 1
        async with self.db_lock:
            cursor = await self.db.execute(
                "SELECT url, real_url, states_json, image_path, scraped_text, title, source, date, summary FROM articles_cache WHERE query = ? AND ui_selected > 0 ORDER BY ui_selected ASC",
                (query_key,)
            )
            rows = await cursor.fetchall()
            if not rows:
                cursor = await self.db.execute(
                    "SELECT url, real_url, states_json, image_path, scraped_text, title, source, date, summary FROM articles_cache WHERE query = ? AND LENGTH(TRIM(scraped_text)) > 200 LIMIT ?",
                    (query_key, target_count)
                )
                rows = await cursor.fetchall()
            
        articles = []
        for r in rows:
            articles.append({
                "url": r[0],
                "real_url": r[1] if r[1] else r[0],
                "states": json.loads(r[2]) if r[2] else [],
                "image": r[3],
                "scraped_text": r[4] if r[4] else "",
                "title": r[5],
                "source": r[6],
                "date": r[7],
                "summary": r[8]
            })
            
        current = 0
        discarded = 0
        total_target = len(articles)
        
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
        
        for a in articles:
            short_title = a['title'][:30]
            elapsed = time.time() - start_time
            
            yield {
                "type": "update",
                "message": f"Analizando el artículo: {short_title}...",
                "phase": "inference",
                "current": current,
                "target": total_target,
                "discarded": discarded,
                "elapsed_time": round(elapsed, 2),
                "text": f"Inference for {short_title}"
            }
            
            try:
                states = a.get("states", [])
                if not states:
                    # Pass text sequentially using Semaphore(1)
                    async with self.nlp_semaphore:
                        states = await self.nlp.extract_states(None, a.get("scraped_text", ""), title=a.get("title", ""), country=search_params.get("country", "mx"))
                    
                    a["states"] = states if isinstance(states, list) else []
                    
                    async with self.db_lock:
                        await self.db.execute(
                            "UPDATE articles_cache SET states_json = ? WHERE url = ?",
                            (json.dumps(a["states"]), a["url"])
                        )
                        await self.db.commit()
                else:
                    a["states"] = states if isinstance(states, list) else []
                
                # Strip raw scraped text before yielding
                a.pop("scraped_text", None)
                
                current += 1
                
                elapsed = time.time() - start_time
                yield {
                    "type": "article",
                    "data": a,
                    "phase": "inference",
                    "current": current,
                    "target": total_target,
                    "discarded": discarded,
                    "elapsed_time": round(elapsed, 2),
                    "text": f"Yielded article {short_title}"
                }
            except Exception as e:
                logger.error(f"❌ [map_stream offline process_task Error] '{short_title}...': {e}")
                a["states"] = []
                a.pop("scraped_text", None)
                current += 1
                elapsed = time.time() - start_time
                yield {
                    "type": "article",
                    "data": a,
                    "phase": "inference",
                    "current": current,
                    "target": total_target,
                    "discarded": discarded,
                    "elapsed_time": round(elapsed, 2),
                    "text": f"Yielded article {short_title} with fallback"
                }
                
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