import os
import json
import logging
import asyncio
from pydantic import ValidationError
from google import genai
from google.genai import types
from groq import AsyncGroq

from utils.schemas import BatchNewsMetrics, NewsMetrics

logger = logging.getLogger(__name__)

_GROQ_KEY = os.environ.get('GROQ_API_KEY', '')
GROQ_MODELS = [m.strip() for m in os.environ.get('GROQ_MODELS', 'openai/gpt-oss-120b').split(',') if m.strip()]
_GEMINI_KEY = os.environ.get('GEMINI_API_KEY', '')
GEMINI_MODEL = os.environ.get('GEMINI_MODEL', 'models/gemini-1.5-flash')

_groq_client = None
_gemini_client = None

def get_groq():
    global _groq_client
    if not _groq_client and _GROQ_KEY:
        _groq_client = AsyncGroq(api_key=_GROQ_KEY)
    return _groq_client

def get_gemini():
    global _gemini_client
    if not _gemini_client and _GEMINI_KEY:
        _gemini_client = genai.Client(api_key=_GEMINI_KEY)
    return _gemini_client

class LLMExtractionError(Exception):
    def __init__(self, message, raw_response): super().__init__(message); self.raw_response = raw_response

async def extract_metrics_batch(articles_data_map: dict, country: str = "mx") -> str:
    batch_prompt = 'Analyze the following batch of articles and extract the required metrics for EACH. Return ONLY valid JSON matching the schema.\n'
    for art_id, item in articles_data_map.items():
        if isinstance(item, dict):
            title = item.get('title', '')
            text = (item.get('text') or '')[:3000]
        else:
            title = ''
            text = (item or '')[:3000]

        batch_prompt += f'\n----\nARTICLE ID: {art_id}\n'
        if title:
            batch_prompt += f'TITLE: {title}\n'
        batch_prompt += f'TEXT: {text}\n'
    
    schema_json = json.dumps(BatchNewsMetrics.model_json_schema())
    
    valid_states = []
    try:
        with open(f"static/maps/{country}_states.geojson", "r", encoding="utf-8") as gf:
            import json as geojson
            gdata = geojson.load(gf)
            valid_states = [f["properties"]["state_name"] for f in gdata.get("features", []) if "state_name" in f["properties"]]
    except Exception as e:
        logger.warning(f"Could not load valid states for {country}: {e}")

    states_hint = ""
    if valid_states:
        states_hint = f"\nALLOWED STATES FOR '{country}': " + ", ".join(valid_states) + "\n"
        states_hint += f"CRITICAL: DO NOT extract any locations from other countries. YOU MUST ONLY extract locations that EXACTLY match one of the ALLOWED STATES listed above.\n"

    dynamic_hints = ""
    try:
        with open("static/maps/map_config.json", "r", encoding="utf-8") as cf:
            import json as json_cfg
            config_data = json_cfg.load(cf)
            country_conf = config_data.get(country, {})
            hints = country_conf.get("llm_hints", "")
            if hints:
                dynamic_hints = f"\nCOUNTRY SPECIFIC HINTS:\n- {hints}\n"
    except Exception as e:
        logger.warning(f"Could not load map_config.json for {country}: {e}")

    sys_prompt = f"""You are a strict data extraction system. You must output JSON that perfectly matches this JSON Schema.

CRITICAL LOCATION MAPPING RULES:
1. TITLE PRIORITY: The headline/title is the PRIMARY focus of the news. If states or cities are explicitly mentioned in the TITLE, they MUST be extracted into 'locations_list'. If the title mentions a specific geographic feature or local area that is NOT an allowed state (e.g. a dam, river, region, or municipality), you SHOULD extract the ALLOWED STATES mentioned in the body ONLY IF they are directly related to the main topic of the title. Do not let secondary sidebars, related links, or unrelated mentions of other states in the body override the main topic.
2. For the 'locations_list' field, you must extract mentioned geographic locations and resolve abbreviations to their FULL formal state names.{states_hint}{dynamic_hints}
JSON Schema:
{schema_json}"""
    
    groq = get_groq()
    last_raw = ''
    if groq:
        for model in GROQ_MODELS:
            try:
                res = await groq.chat.completions.create(
                    model=model,
                    messages=[
                        {'role': 'system', 'content': sys_prompt},
                        {'role': 'user', 'content': batch_prompt}
                    ],
                    response_format={'type': 'json_object'},
                    temperature=0.0
                )
                last_raw = res.choices[0].message.content
                return last_raw
            except Exception as e:
                logger.warning(f'Groq model {model} failed extraction: {e}')
                continue
                
    gemini = get_gemini()
    if gemini:
        try:
            res = await gemini.aio.models.generate_content(
                model=GEMINI_MODEL,
                contents=[{'role': 'user', 'parts': [{'text': batch_prompt}]}],
                config=types.GenerateContentConfig(
                    system_instruction=sys_prompt,
                    response_mime_type='application/json',
                    response_schema=BatchNewsMetrics.model_json_schema()
                )
            )
            last_raw = res.text
            return last_raw
        except Exception as e:
            logger.warning(f'Gemini failed extraction: {e}')
            raise LLMExtractionError(str(e), last_raw if last_raw else '')
    
    raise Exception('No LLM clients available.')

async def process_articles_batch(pool, articles_batch: list, country: str = "mx"):
    if not articles_batch:
        return

    articles_data_map = {}
    execution_id_map = {}
    for a in articles_batch:
        articles_data_map[a['article_id']] = {
            'title': a.get('title') or '',
            'text': a.get('content_snippet') or ''
        }
        execution_id_map[a['article_id']] = a.get('execution_id')

    try:
        raw_json_str = await extract_metrics_batch(articles_data_map, country)
    except LLMExtractionError as e:
        logger.error(f'Extraction error for batch: {e}')
        for art_id in articles_data_map.keys():
            await _send_to_dlq(pool, art_id, execution_id_map[art_id], e.raw_response, str(e))
        return
    except Exception as e:
        logger.error(f'Extraction error for batch: {e}')
        for art_id in articles_data_map.keys():
            await _send_to_dlq(pool, art_id, execution_id_map[art_id], 'None', str(e))
        return

    try:
        parsed_data = json.loads(raw_json_str)
        results = parsed_data.get('results', [])
    except json.JSONDecodeError as e:
        logger.error(f'Failed to parse LLM JSON response: {e}')
        for art_id in articles_data_map.keys():
            await _send_to_dlq(pool, art_id, execution_id_map[art_id], raw_json_str, f'JSONDecodeError: {e}')
        return

    async with pool.acquire() as conn:
        for res_dict in results:
            article_id = res_dict.get('article_id')
            execution_id = execution_id_map.get(article_id)
            if not article_id or not execution_id:
                continue
            
            try:
                validated_metrics = NewsMetrics(**res_dict)
                
                await conn.execute('''
                    UPDATE fact_news_metrics 
                    SET sentiment_score = $3, word_count = $4, entity_count = $5
                    WHERE article_id = $1 AND execution_id = $2
                ''', article_id, execution_id, validated_metrics.sentiment_score, 
                    len((articles_data_map.get(article_id, {}).get('text') or '').split()), 
                    len(validated_metrics.entities_list))
                
                await conn.execute('''
                    UPDATE articles
                    SET geodata = $1::jsonb
                    WHERE article_id = $2 AND execution_id = $3
                ''', json.dumps(validated_metrics.locations_list), article_id, execution_id)
                
                for ent in validated_metrics.entities_list:
                    await conn.execute('''
                        INSERT INTO dim_entities (article_id, execution_id, entity_text, entity_type)
                        VALUES ($1, $2, $3, $4)
                    ''', article_id, execution_id, ent.entity_text, ent.entity_type)
                    
            except ValidationError as e:
                logger.warning(f'Invalid article metrics for {article_id}: {e}')
                await _send_to_dlq(conn, article_id, execution_id, json.dumps(res_dict), str(e))
            except Exception as e:
                logger.error(f'DB error for article {article_id}: {e}')
                await _send_to_dlq(conn, article_id, execution_id, json.dumps(res_dict), str(e))

        # Retry individually any article the LLM silently skipped in the batch
        responded_ids = {r.get('article_id') for r in results}
        missed_ids = [art_id for art_id in execution_id_map if art_id not in responded_ids]
        if missed_ids:
            logger.warning(f"[process_articles_batch] LLM missed {len(missed_ids)} articles — retrying individually.")
        for art_id in missed_ids:
            exec_id = execution_id_map[art_id]
            single_map = {art_id: articles_data_map[art_id]}
            try:
                retry_raw = await extract_metrics_batch(single_map, country)
                retry_parsed = json.loads(retry_raw)
                retry_results = retry_parsed.get('results', [])
                found = next((r for r in retry_results if r.get('article_id') == art_id), None)
                if found:
                    validated_metrics = NewsMetrics(**found)
                    await conn.execute('''
                        UPDATE fact_news_metrics
                        SET sentiment_score = $3, word_count = $4, entity_count = $5
                        WHERE article_id = $1 AND execution_id = $2
                    ''', art_id, exec_id, validated_metrics.sentiment_score,
                        len((single_map.get(art_id, {}).get('text') or '').split()),
                        len(validated_metrics.entities_list))
                    await conn.execute('''
                        UPDATE articles
                        SET geodata = $1::jsonb
                        WHERE article_id = $2 AND execution_id = $3
                    ''', json.dumps(validated_metrics.locations_list), art_id, exec_id)
                    for ent in validated_metrics.entities_list:
                        await conn.execute('''
                            INSERT INTO dim_entities (article_id, execution_id, entity_text, entity_type)
                            VALUES ($1, $2, $3, $4)
                        ''', art_id, exec_id, ent.entity_text, ent.entity_type)
                    logger.info(f"[retry] Recovered article {art_id} → locations={validated_metrics.locations_list}")
                else:
                    # LLM responded but still missed the article in the retry — send to DLQ
                    await _send_to_dlq(conn, art_id, exec_id, retry_raw, 'LLM missed article in single-article retry')
            except Exception as e:
                logger.error(f"[retry] Single-article retry failed for {art_id}: {e}")
                await _send_to_dlq(conn, art_id, exec_id, '', str(e))

async def _send_to_dlq(pool, article_id, execution_id, raw_response, error_reason):
    if hasattr(pool, 'execute'):
        conn = pool
        await conn.execute('''
            INSERT INTO dlq_news_metrics (article_id, execution_id, raw_response, error_reason)
            VALUES ($1, $2, $3, $4)
        ''', article_id, execution_id, raw_response, error_reason)
    else:
        async with pool.acquire() as conn:
            await conn.execute('''
                INSERT INTO dlq_news_metrics (article_id, execution_id, raw_response, error_reason)
                VALUES ($1, $2, $3, $4)
            ''', article_id, execution_id, raw_response, error_reason)
