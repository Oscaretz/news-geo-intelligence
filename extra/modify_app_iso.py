import re

with open("app.py", "r", encoding="utf-8") as f:
    code = f.read()

# Update /api/jobs to return ISO 8601 instead of timestamp
old_api_jobs_1 = """                    def to_ts(dt):
                        if not dt: return None
                        if dt.tzinfo is None:
                            dt = dt.replace(tzinfo=datetime.timezone.utc)
                        return dt.timestamp()"""
new_api_jobs_1 = """                    def to_iso(dt):
                        if not dt: return None
                        if dt.tzinfo is None:
                            dt = dt.replace(tzinfo=datetime.timezone.utc)
                        return dt.isoformat()"""
code = code.replace(old_api_jobs_1, new_api_jobs_1)

old_api_jobs_2 = """                            "start_time": to_ts(r['timestamp']),
                            "end_time": to_ts(r['end_time']),"""
new_api_jobs_2 = """                            "start_time": to_iso(r['timestamp']),
                            "end_time": to_iso(r['end_time']),"""
code = code.replace(old_api_jobs_2, new_api_jobs_2)

# Update /api/history to return ISO 8601 for both timestamp and end_time
old_api_history_1 = """        for run in history:
            if 'timestamp' in run and run['timestamp']:
                run['timestamp'] = run['timestamp'].isoformat()"""
new_api_history_1 = """        for run in history:
            if 'timestamp' in run and run['timestamp']:
                run['timestamp'] = run['timestamp'].isoformat()
            if 'end_time' in run and run['end_time']:
                run['end_time'] = run['end_time'].isoformat()"""
code = code.replace(old_api_history_1, new_api_history_1)

with open("app.py", "w", encoding="utf-8") as f:
    f.write(code)
