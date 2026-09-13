import re

with open("static/js/ui.js", "r", encoding="utf-8") as f:
    code = f.read()

old_hist_1 = """    const filtered = historyData.filter(h => 
        (h.search_term || '').toLowerCase().includes(filterText) ||
        JSON.stringify(h.filters || {}).toLowerCase().includes(filterText)
    );"""
new_hist_1 = """    const filtered = historyData.filter(h => 
        (h.search_term || '').toLowerCase().includes(filterText) ||
        JSON.stringify(h.filters || {}).toLowerCase().includes(filterText)
    );
    
    // Sort descending by Phase 1 timestamp (Scraped On)
    filtered.sort((a, b) => {
        const timeA = new Date(a.timestamp || 0).getTime();
        const timeB = new Date(b.timestamp || 0).getTime();
        return timeB - timeA;
    });"""
code = code.replace(old_hist_1, new_hist_1)

old_hist_2 = """        } catch(e) {}
        
        const dateStr = run.timestamp ? new Date(run.timestamp).toLocaleString() : 'N/A';
        
        let statusBadge = '';"""
new_hist_2 = """        } catch(e) {}
        
        const dateHtml = formatTemporal(run.timestamp);
        
        let statusBadge = '';"""
code = code.replace(old_hist_2, new_hist_2)

old_hist_3 = """        tr.innerHTML = `
            <td class="py-3 px-3 w-[160px] text-xs">${dateStr}${statusBadge}</td>
            <td class="py-3 px-3 font-medium w-[200px] truncate" title="${run.search_term}">${run.search_term || '-'}</td>"""
new_hist_3 = """        tr.innerHTML = `
            <td class="py-3 px-3 w-[180px] text-xs flex items-center flex-wrap gap-2">${dateHtml}${statusBadge}</td>
            <td class="py-3 px-3 font-medium w-[200px] truncate" title="${run.search_term}">${run.search_term || '-'}</td>"""
code = code.replace(old_hist_3, new_hist_3)

with open("static/js/ui.js", "w", encoding="utf-8") as f:
    f.write(code)
