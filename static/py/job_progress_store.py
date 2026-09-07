import sqlite3
import os
import platform

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
dagster_home_dir = os.path.join(BASE_DIR, "dagster_home")
DB_PATH = os.path.join(dagster_home_dir, "job_progress.db")

def _get_conn():
    os.makedirs(dagster_home_dir, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=5.0)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS job_progress (
            run_id TEXT PRIMARY KEY,
            progress_pct REAL,
            current_step TEXT
        )
    ''')
    conn.commit()
    return conn

def update_progress(run_id, progress_pct, current_step):
    try:
        with _get_conn() as conn:
            conn.execute('''
                INSERT INTO job_progress (run_id, progress_pct, current_step)
                VALUES (?, ?, ?)
                ON CONFLICT(run_id) DO UPDATE SET
                    progress_pct=excluded.progress_pct,
                    current_step=excluded.current_step
            ''', (run_id, progress_pct, current_step))
    except Exception as e:
        print(f"Failed to update progress: {e}")

def get_progress(run_id):
    try:
        with _get_conn() as conn:
            cur = conn.execute('SELECT progress_pct, current_step FROM job_progress WHERE run_id = ?', (run_id,))
            row = cur.fetchone()
            if row:
                return {"progress_pct": row[0], "current_step": row[1]}
    except Exception as e:
        print(f"Failed to get progress: {e}")
    return {"progress_pct": 0, "current_step": "Starting..."}
