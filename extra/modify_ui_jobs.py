import re

with open("static/js/ui.js", "r", encoding="utf-8") as f:
    code = f.read()

# Add formatTemporal at the top
temporal_func = """
function formatTemporal(isoString) {
    if (!isoString) return '<span class="text-on-surface-variant text-sm">-</span>';
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '<span class="text-on-surface-variant text-sm">-</span>';

    const now = new Date();
    const diffMs = Math.max(0, now - date);
    const diffHrs = diffMs / (1000 * 60 * 60);

    const fullLocal = date.toLocaleString();
    let displayStr = '';
    
    if (diffHrs < 24) {
        const diffMins = Math.floor(diffMs / (1000 * 60));
        if (diffMins < 1) displayStr = "Just now";
        else if (diffMins < 60) displayStr = `${diffMins} mins ago`;
        else {
            const hrs = Math.floor(diffHrs);
            displayStr = `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
        }
    } else {
        const options = { day: '2-digit', month: 'short' };
        displayStr = date.toLocaleDateString(undefined, options);
        if (date.getFullYear() !== now.getFullYear()) {
            displayStr += ` ${date.getFullYear()}`;
        }
    }
    return `<span title="${fullLocal}" class="cursor-help text-sm font-medium text-on-surface">${displayStr}</span>`;
}
"""
code = code.replace("function initUI() {", temporal_func + "\nfunction initUI() {")

# Update renderJobsQueue: elapsed logic, sort logic, and row html
old_jobs_1 = """function renderJobsQueue(jobs) {
    const tbody = document.getElementById('jobsTableBody');
    if (!tbody) return;
    
    currentJobsData = jobs;"""
new_jobs_1 = """function renderJobsQueue(jobs) {
    const tbody = document.getElementById('jobsTableBody');
    if (!tbody) return;
    
    // Sort descending by end_time (Last Updated) or start_time
    jobs.sort((a, b) => {
        const timeA = new Date(a.end_time || a.start_time || 0).getTime();
        const timeB = new Date(b.end_time || b.start_time || 0).getTime();
        return timeB - timeA;
    });
    
    currentJobsData = jobs;"""
code = code.replace(old_jobs_1, new_jobs_1)

old_jobs_2 = """        let elapsedStr = "-";
        if (job.start_time) {
            let end = Date.now();
            if (job.end_time) {
                end = job.end_time * 1000;
            } else if (!['STARTED', 'STARTING', 'SCRAPING', 'QUEUED_FOR_ANALYSIS', 'ANALYZING'].includes(job.status)) {
                end = job.start_time * 1000; // Freeze at 00:00 for legacy jobs without end_time
            }
            const start = job.start_time * 1000;
            const diffSec = Math.max(0, Math.floor((end - start) / 1000));
            const m = Math.floor(diffSec / 60).toString().padStart(2, '0');
            const s = (diffSec % 60).toString().padStart(2, '0');
            elapsedStr = `${m}:${s}`;
        }"""
new_jobs_2 = """        let elapsedStr = "-";
        if (job.start_time) {
            let end = Date.now();
            const startDate = new Date(job.start_time).getTime();
            if (job.end_time) {
                end = new Date(job.end_time).getTime();
            } else if (!['STARTED', 'STARTING', 'SCRAPING', 'QUEUED_FOR_ANALYSIS', 'ANALYZING'].includes(job.status)) {
                end = startDate;
            }
            const start = startDate;
            const diffSec = Math.max(0, Math.floor((end - start) / 1000));
            const m = Math.floor(diffSec / 60).toString().padStart(2, '0');
            const s = (diffSec % 60).toString().padStart(2, '0');
            elapsedStr = `${m}:${s}`;
        }
        
        const lastUpdatedHtml = formatTemporal(job.end_time || job.start_time);"""
code = code.replace(old_jobs_2, new_jobs_2)

old_jobs_3 = """                    <td class="py-3 px-4 w-[220px]">
                        ${statusHtml}
                    </td>
                    <td class="py-3 px-4 font-mono text-sm text-on-surface-variant w-[100px]">${elapsedStr}</td>
                    <td class="py-3 px-4 text-right w-[150px]">"""
new_jobs_3 = """                    <td class="py-3 px-4 w-[220px]">
                        ${statusHtml}
                    </td>
                    <td class="py-3 px-4 w-[140px]">${lastUpdatedHtml}</td>
                    <td class="py-3 px-4 font-mono text-sm text-on-surface-variant w-[100px]">${elapsedStr}</td>
                    <td class="py-3 px-4 text-right w-[150px]">"""
code = code.replace(old_jobs_3, new_jobs_3)

with open("static/js/ui.js", "w", encoding="utf-8") as f:
    f.write(code)
