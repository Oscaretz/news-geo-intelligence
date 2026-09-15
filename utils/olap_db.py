import asyncpg
import logging
import datetime

logger = logging.getLogger(__name__)

async def load_metrics_upsert(pool: asyncpg.Pool, metrics_data: list):
    """
    metrics_data is a list of dicts:
    [
        {
            'article_id': '...',
            'execution_id': '...',
            'date_str': '2026-09-13',
            'source_name': '...',
            'title': '...',
            'url': '...',
            'word_count': 100,
            'entity_count': 5,
            'sentiment_score': 0.8
        }, ...
    ]
    """
    async with pool.acquire() as conn:
        async with conn.transaction():
            for row in metrics_data:
                # 1. UPSERT dim_date
                date_str = row.get('date_str')
                date_key = None
                if date_str:
                    try:
                        # Convert date_str to date if possible
                        try:
                            # if format is full timestamp
                            parsed_date = datetime.datetime.fromisoformat(date_str.replace('Z', '+00:00')).date()
                        except ValueError:
                            # simple date
                            parsed_date = datetime.datetime.strptime(date_str[:10], '%Y-%m-%d').date()
                        
                        date_key = parsed_date
                        await conn.execute('''
                            INSERT INTO dim_date (date_key, date_str, year, month, day)
                            VALUES ($1, $2, $3, $4, $5)
                            ON CONFLICT (date_key) DO NOTHING
                        ''', parsed_date, date_str, parsed_date.year, parsed_date.month, parsed_date.day)
                    except Exception as e:
                        logger.warning(f"Could not parse date string {date_str}: {e}")

                # 2. UPSERT dim_source
                source_name = row.get('source_name')
                source_id = None
                if source_name:
                    source_id_row = await conn.fetchrow('''
                        INSERT INTO dim_source (source_name)
                        VALUES ($1)
                        ON CONFLICT (source_name) DO UPDATE SET source_name = EXCLUDED.source_name
                        RETURNING source_id
                    ''', source_name)
                    if source_id_row:
                        source_id = source_id_row['source_id']

                # 3. UPSERT fact_news_metrics
                await conn.execute('''
                    INSERT INTO fact_news_metrics (article_id, execution_id, date_key, source_id, word_count, entity_count, sentiment_score)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (article_id, execution_id) DO UPDATE SET
                        date_key = EXCLUDED.date_key,
                        source_id = EXCLUDED.source_id,
                        word_count = EXCLUDED.word_count,
                        entity_count = EXCLUDED.entity_count,
                        sentiment_score = EXCLUDED.sentiment_score
                ''', row.get('article_id'), row.get('execution_id'), date_key, source_id, row.get('word_count', 0), row.get('entity_count', 0), row.get('sentiment_score', 0.0))

async def load_entities_upsert(pool: asyncpg.Pool, entities_data: list):
    """
    entities_data: [{'article_id': '...', 'execution_id': '...', 'entity_text': '...', 'entity_type': '...'}, ...]
    """
    async with pool.acquire() as conn:
        async with conn.transaction():
            for row in entities_data:
                await conn.execute('''
                    INSERT INTO dim_entities (article_id, execution_id, entity_text, entity_type)
                    VALUES ($1, $2, $3, $4)
                ''', row.get('article_id'), row.get('execution_id'), row.get('entity_text'), row.get('entity_type'))