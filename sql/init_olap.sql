DROP VIEW IF EXISTS fact_news_metrics CASCADE;
DROP VIEW IF EXISTS dim_date CASCADE;
DROP VIEW IF EXISTS dim_source CASCADE;
DROP VIEW IF EXISTS scraper_logs CASCADE;

CREATE TABLE dim_date (
    date_key DATE PRIMARY KEY,
    date_str TEXT UNIQUE NOT NULL,
    year INTEGER,
    month INTEGER,
    day INTEGER
);

CREATE TABLE dim_source (
    source_id SERIAL PRIMARY KEY,
    source_name TEXT UNIQUE NOT NULL
);

CREATE TABLE dim_entities (
    entity_id SERIAL PRIMARY KEY,
    article_id TEXT NOT NULL,
    execution_id TEXT NOT NULL,
    entity_text TEXT,
    entity_type TEXT,
    FOREIGN KEY (article_id, execution_id) REFERENCES articles(article_id, execution_id) ON DELETE CASCADE
);

CREATE TABLE fact_news_metrics (
    article_id TEXT NOT NULL,
    execution_id TEXT NOT NULL,
    date_key DATE,
    source_id INTEGER,
    word_count INTEGER DEFAULT 0,
    entity_count INTEGER DEFAULT 0,
    sentiment_score NUMERIC(5,2) DEFAULT 0.0,
    PRIMARY KEY (article_id, execution_id),
    FOREIGN KEY (date_key) REFERENCES dim_date(date_key) ON DELETE SET NULL,
    FOREIGN KEY (source_id) REFERENCES dim_source(source_id) ON DELETE SET NULL
);

