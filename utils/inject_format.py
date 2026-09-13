import os

with open("static/js/ui.js", "r", encoding="utf-8") as f:
    code = f.read()

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

if "function formatTemporal" not in code:
    code = temporal_func + "\n" + code
    with open("static/js/ui.js", "w", encoding="utf-8") as f:
        f.write(code)
