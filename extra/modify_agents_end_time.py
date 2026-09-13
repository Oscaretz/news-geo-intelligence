import re

with open("agents.py", "r", encoding="utf-8") as f:
    code = f.read()

old_sql = \"\"\"                SELECT 
                    se.execution_id, 
                    se.timestamp, 
                    se.search_term, 
                    se.filters, 
                    se.status,
                    COUNT(a.article_id) as total_articles 
                FROM search_executions se 
                LEFT JOIN articles a ON se.execution_id = a.execution_id 
                GROUP BY se.execution_id, se.timestamp, se.search_term, se.filters, se.status 
                ORDER BY se.timestamp DESC
            \"\"\")
            
            return [dict(r) for r in records]\"\"\"

new_sql = \"\"\"                SELECT 
                    se.execution_id, 
                    se.timestamp, 
                    se.end_time,
                    se.search_term, 
                    se.filters, 
                    se.status,
                    COUNT(a.article_id) as total_articles 
                FROM search_executions se 
                LEFT JOIN articles a ON se.execution_id = a.execution_id 
                GROUP BY se.execution_id, se.timestamp, se.end_time, se.search_term, se.filters, se.status 
                ORDER BY se.timestamp DESC
            \"\"\")
            
            return [dict(r) for r in records]\"\"\"

code = code.replace(old_sql, new_sql)

with open("agents.py", "w", encoding="utf-8") as f:
    f.write(code)
