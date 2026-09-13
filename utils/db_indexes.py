"""
db_indexes.py — DDL migration module for high-performance PostgreSQL indexes.

Applies idempotent CREATE INDEX CONCURRENTLY and GIN indexes on:
  - search_executions: execution_id (PK already), status, timestamp
  - articles: execution_id (FK), geodata (GIN on JSONB)

Safe to call on every application startup — uses IF NOT EXISTS guards.
"""

import asyncio
import logging
import os

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# DDL statements — all CONCURRENTLY so they never lock tables in production
# ---------------------------------------------------------------------------
INDEX_STATEMENTS = [
    # ── search_executions ──────────────────────────────────────────────────
    # Status lookups (QUEUED_FOR_ANALYSIS, ANALYZING, SCRAPED, …)
    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_se_status
        ON search_executions (status);
    """,
    # Temporal sort — used by ORDER BY timestamp DESC in /api/jobs and /api/history
    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_se_timestamp
        ON search_executions (timestamp DESC);
    """,
    # end_time / scraped_at for history ordering
    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_se_scraped_at
        ON search_executions (scraped_at DESC NULLS LAST);
    """,
    # Covering index for the jobs list query (status + timestamp together)
    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_se_status_ts
        ON search_executions (status, timestamp DESC);
    """,

    # ── articles ───────────────────────────────────────────────────────────
    # Foreign key / execution lookup — the most frequent predicate
    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_art_execution_id
        ON articles (execution_id);
    """,
    # Partial index: articles not yet geo-coded (geodata IS NULL), used
    # heavily in map_stream to fetch un-processed rows
    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_art_exec_geodata_null
        ON articles (execution_id)
        WHERE geodata IS NULL;
    """,
    # GIN index on JSONB geodata — enables fast @> and ? containment queries
    # on the geographic entities array stored in each article row
    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_art_geodata_gin
        ON articles USING GIN (geodata);
    """,
    # GIN index on JSONB filters column in search_executions
    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_se_filters_gin
        ON search_executions USING GIN (filters);
    """,
]


async def apply_indexes(pool) -> None:
    """
    Apply all index DDL statements against an existing asyncpg connection pool.
    Each statement is executed in its own connection because CONCURRENTLY
    cannot run inside a transaction block.
    """
    for stmt in INDEX_STATEMENTS:
        clean = " ".join(stmt.split())
        try:
            # CONCURRENTLY requires autocommit — acquire raw connection
            async with pool.acquire() as conn:
                await conn.execute(stmt)
            logger.info(f"[db_indexes] ✅ Applied: {clean[:80]}…")
        except Exception as exc:
            # Non-fatal: index may already exist or DB user lacks rights
            logger.warning(f"[db_indexes] ⚠️  Skipped (non-fatal): {clean[:80]}… — {exc}")


def apply_indexes_sync(db_url: str) -> None:
    """
    Convenience wrapper for synchronous startup contexts (e.g. called from
    the Flask main block before the server starts).
    """
    import asyncpg

    async def _run():
        pool = await asyncpg.create_pool(db_url, min_size=1, max_size=3)
        try:
            await apply_indexes(pool)
        finally:
            await pool.close()

    asyncio.run(_run())


if __name__ == "__main__":
    # Allow manual execution:  python -m utils.db_indexes
    from dotenv import load_dotenv
    load_dotenv()
    db_url = os.environ.get("DATABASE_URL")
    logging.basicConfig(level=logging.INFO)
    apply_indexes_sync(db_url)
    print("Index migration complete.")
