import re

with open("templates/index.html", "r", encoding="utf-8") as f:
    code = f.read()

# Update Jobs table
old_jobs_headers = """                            <th class="py-3 px-4 font-medium">Status</th>
                            <th class="py-3 px-4 font-medium">Elapsed Time</th>"""
new_jobs_headers = """                            <th class="py-3 px-4 font-medium">Status</th>
                            <th class="py-3 px-4 font-medium">Last Updated</th>
                            <th class="py-3 px-4 font-medium">Elapsed Time</th>"""
code = code.replace(old_jobs_headers, new_jobs_headers)

# Update History table
old_hist_headers = """                            <th class="py-2 px-3">Date/Time</th>
                            <th class="py-2 px-3">Search Term</th>"""
new_hist_headers = """                            <th class="py-2 px-3">Scraped On</th>
                            <th class="py-2 px-3">Search Term</th>"""
code = code.replace(old_hist_headers, new_hist_headers)

with open("templates/index.html", "w", encoding="utf-8") as f:
    f.write(code)
