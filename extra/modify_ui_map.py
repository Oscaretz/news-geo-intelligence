import re

with open("static/js/ui.js", "r", encoding="utf-8") as f:
    code = f.read()

# Change viewExecution to switch to analytics tab if there are states
old_view = """        // Unhide action buttons
        const exportBtn = document.getElementById('exportExcelBtn');
        if (exportBtn) exportBtn.classList.remove('hidden');
        const mapearBtn = document.getElementById('mapearBtn');
        if (mapearBtn) mapearBtn.classList.remove('hidden');

        switchTab('main');
        renderTopStories();
        renderFullFeed();

        if (typeof populateAnalyticsFilters === 'function') populateAnalyticsFilters();"""

new_view = """        // Unhide action buttons
        const exportBtn = document.getElementById('exportExcelBtn');
        if (exportBtn) exportBtn.classList.remove('hidden');
        const mapearBtn = document.getElementById('mapearBtn');
        if (mapearBtn) mapearBtn.classList.remove('hidden');

        renderTopStories();
        renderFullFeed();

        if (typeof populateAnalyticsFilters === 'function') populateAnalyticsFilters();
        
        // Auto-switch to analytics tab if we have geodata, otherwise main
        const hasGeodata = collectedArticles.some(a => a.states && a.states.length > 0);
        if (hasGeodata) {
            switchTab('analytics');
        } else {
            switchTab('main');
        }"""
code = code.replace(old_view, new_view)

# Also fix typeof map check just to be absolutely sure it invalidates size safely
old_switch = """        if (typeof map !== 'undefined' && map !== null) {
            setTimeout(() => {
                map.invalidateSize();
                if (currentCountryConfig && isValidCenter(currentCountryConfig.center)) {
                    map.setView(currentCountryConfig.center, currentCountryConfig.zoom || 4);
                }
            }, 300); // Small delay to allow CSS transitions to finish before sizing
        }"""
new_switch = """        setTimeout(() => {
            if (typeof window.invalidateMapSize === 'function') {
                window.invalidateMapSize();
            } else if (typeof map !== 'undefined' && map !== null) {
                map.invalidateSize();
                if (typeof currentCountryConfig !== 'undefined' && currentCountryConfig && currentCountryConfig.center) {
                    map.setView(currentCountryConfig.center, currentCountryConfig.zoom || 4);
                }
            }
        }, 300);"""
code = code.replace(old_switch, new_switch)

with open("static/js/ui.js", "w", encoding="utf-8") as f:
    f.write(code)
