CREATE TABLE IF NOT EXISTS dlq_news_metrics (
    id SERIAL PRIMARY KEY,
    article_id TEXT NOT NULL,
    execution_id TEXT NOT NULL,
    raw_response TEXT,
    error_reason TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (article_id, execution_id) REFERENCES articles(article_id, execution_id) ON DELETE CASCADE
);
