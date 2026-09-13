import re

with open("app.py", "r", encoding="utf-8") as f:
    code = f.read()

# Add a Werkzeug filter to suppress /api/jobs
if "class NoJobsFilter" not in code:
    filter_code = """import logging
class NoJobsFilter(logging.Filter):
    def filter(self, record):
        return '/api/jobs HTTP' not in record.getMessage()

logging.getLogger('werkzeug').addFilter(NoJobsFilter())
"""
    new_code = code.replace("app = Flask(__name__)", filter_code + "\napp = Flask(__name__)")
    
    with open("app.py", "w", encoding="utf-8") as f:
        f.write(new_code)
