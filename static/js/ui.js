// static/js/ui.js — DOM manipulation, KPI computation, article rendering

// ============================================
// Utility: Debounce Function
// ============================================
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
}

let collectedArticles = [];
let currentMode = '';
let totalArticles = 0;
let uniqueStates = new Set();
let stateFrequency = {};
let sourceFrequency = {};
let currentFilter = null; // Variable para controlar el filtro de BI

function handleKeyPress(e) {
    if (e.key === 'Enter') fetchDiscovery();
}

function updateStatus(message) {
    const statusBox = document.getElementById('statusBox');
    if (!statusBox) return;

    statusBox.style.display = 'block';

    if (message.includes('Resolving URL for:') || message.includes('Resolving URL')) {
        const title = message.replace(/^.*Resolving URL for:\s*/i, '').replace(/\.\.\.$/, '').trim();
        statusBox.innerHTML = `⏳ Analizando: ${title}...`;
    } else if (message.includes('All processing complete!')) {
        statusBox.innerHTML = `✅ Análisis completado`;
        setTimeout(() => {
            statusBox.style.display = 'none';
        }, 3000);
    } else {
        statusBox.innerHTML = message;
    }
}

function resetUI(mode) {
    currentMode = mode;
    totalArticles = 0;
    uniqueStates = new Set();
    stateFrequency = {};
    sourceFrequency = {};
    collectedArticles = [];
    currentFilter = null;

    // Status
    const statusBox = document.getElementById('statusBox');
    statusBox.style.display = 'block';
    statusBox.innerHTML = '';

    // Dashboard
    const dashboard = document.getElementById('dashboard');
    dashboard.style.display = 'flex';
    document.getElementById('articlesFeed').innerHTML = '';
    document.getElementById('actionButtons').style.display = 'none';
    feedCurrentPage = 0;
    feedSelectedSources = new Set();
    feedSelectedStates = new Set();
    analyticsSelectedStates  = new Set();
    analyticsSelectedSources = new Set();
    const fullFeedList = document.getElementById('fullFeedList');
    if (fullFeedList) fullFeedList.innerHTML = '';
    const feedInfo = document.getElementById('feedPaginationInfo');
    if (feedInfo) feedInfo.textContent = '';
    const subtitleEl = document.getElementById('news-summary-subtitle');
    if (subtitleEl) subtitleEl.textContent = 'No dates available';

    // Hide export & map buttons until data arrives
    const exportBtn = document.getElementById('exportExcelBtn');
    if (exportBtn) exportBtn.classList.add('hidden');
    const mapearBtn = document.getElementById('mapearBtn');
    if (mapearBtn) mapearBtn.classList.add('hidden');
    
    const filterBanner = document.getElementById('filterBanner');
    if (filterBanner) filterBanner.style.display = 'none';

    // KPIs
    // document.getElementById('kpiTotal').textContent = '0';
    // document.getElementById('kpiCoverage').textContent = '0';
    // document.getElementById('kpiEpicenter').textContent = '—';
    // document.getElementById('kpiTopSource').textContent = '—';
    
    const kpiTotal = document.getElementById('kpiTotal');
    const kpiCoverage = document.getElementById('kpiCoverage');
    const kpiEpicenter = document.getElementById('kpiEpicenter');
    const kpiTopSource = document.getElementById('kpiTopSource');

    if (kpiTotal) kpiTotal.textContent = '0';
    if (kpiCoverage) kpiCoverage.textContent = '0';
    if (kpiEpicenter) kpiEpicenter.textContent = '—';
    if (kpiTopSource) kpiTopSource.textContent = '—';

    // Charts (Llamamos a la nueva función global de analytics.js)
    if (typeof resetAnalytics === 'function') resetAnalytics();

    // Map vs Grid mode
    const mapWrapper = document.getElementById('mapWrapper');
    const feed = document.getElementById('articlesFeed');
    const btnDlMap = document.getElementById('btnDownloadMap');

    if (mode === 'discovery') {
        if (mapWrapper) mapWrapper.style.display = 'none';
        if (feed) feed.classList.add('grid-mode');
        if (btnDlMap) btnDlMap.style.display = 'none';
        updateStatus('Obteniendo noticias y metadata de Google...');
    } else {
        if (mapWrapper) mapWrapper.style.display = 'block';
        if (feed) feed.classList.remove('grid-mode');
        if (btnDlMap) btnDlMap.style.display = '';
        
        if (typeof initMap === 'function') initMap(true);
        if (typeof resetMapState === 'function') resetMapState();
        
        updateStatus('Buscando el buffer de noticias...');
    }
}

let feedCurrentPage = 0;
const FEED_PAGE_SIZE = 10;

function renderArticle(article, mode) {
    if (!collectedArticles.some(a => a.url === article.url)) {
        collectedArticles.push(article);
    }
    renderTopStories();
    renderFullFeed();
}

function renderTopStories(articles = null) {
    const feed = document.getElementById('articlesFeed');
    if (!feed) return;
    feed.innerHTML = '';

    const sourceData = articles || collectedArticles;
    const recent = sourceData.slice(-2).reverse();

    if (recent[0]) {
        const a = recent[0];
        const url = currentMode === 'mapping' ? (a.real_url || a.url) : a.url;
        const imgUrl = a.image || 'https://placehold.co/600x400/e2e8f0/475569?text=News+Image';
        const hasStates = a.states && a.states.length > 0;
        const locationText = hasStates ? a.states.join(', ') : 'Sin localidad';
        const locationCls = hasStates ? 'text-tertiary font-medium' : 'text-on-surface-variant';

        const card = document.createElement('article');
        card.className = 'group cursor-pointer';
        card.innerHTML = `
            <a href="${url}" target="_blank" class="block">
                <div class="overflow-hidden rounded-xl mb-3 h-72">
                    <img src="${imgUrl}"
                         alt="News" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                         onerror="this.src='https://placehold.co/600x400/e2e8f0/475569?text=News+Image'">
                </div>
                <h3 class="text-title-md font-title-md text-on-background group-hover:text-primary-container transition-colors mb-1 leading-snug">${a.title}</h3>
                <div class="flex items-center gap-3 text-label-md text-on-surface-variant mb-1">
                    <span>${a.source}</span><span>·</span><span>${a.date}</span>
                </div>
                <span class="text-xs ${locationCls} mt-0.5 block truncate">${locationText}</span>
            </a>`;
        feed.appendChild(card);
    }

    if (recent[1]) {
        const a = recent[1];
        const url = currentMode === 'mapping' ? (a.real_url || a.url) : a.url;
        const hasStates = a.states && a.states.length > 0;
        const locationText = hasStates ? a.states.join(', ') : 'Sin localidad';
        const locationCls = hasStates ? 'text-tertiary font-medium' : 'text-on-surface-variant';

        const card = document.createElement('article');
        card.className = 'group cursor-pointer pt-md border-t border-outline-variant/20';
        card.innerHTML = `
            <a href="${url}" target="_blank" class="block">
                <h4 class="text-body-lg font-medium text-on-background group-hover:text-primary-container transition-colors mb-1">${a.title}</h4>
                <div class="flex items-center gap-3 text-label-md text-on-surface-variant mb-1">
                    <span>${a.source}</span><span>·</span><span>${a.date}</span>
                </div>
                <span class="text-xs ${locationCls} mt-0.5 block truncate">${locationText}</span>
            </a>`;
        feed.appendChild(card);
    }
}


// ============================================
// Feed Filter Popover (Checkbox-based)
// ============================================

let feedSelectedSources = new Set();
let feedSelectedStates = new Set();

function toggleFeedFilterPopover() {
    const popover = document.getElementById('feedFilterPopover');
    if (!popover) return;
    popover.classList.toggle('hidden');
    if (!popover.classList.contains('hidden')) {
        buildFeedFilterCheckboxes();
    }
}

function buildFeedFilterCheckboxes() {
    // Sources
    const srcContainer = document.getElementById('feedSourceCheckboxes');
    if (srcContainer) {
        srcContainer.innerHTML = '';
        Object.keys(sourceFrequency).sort().forEach(src => {
            const label = document.createElement('label');
            label.className = 'flex items-center gap-2 text-body-md text-on-surface cursor-pointer hover:bg-surface-container-low rounded px-1 py-0.5';
            const checked = feedSelectedSources.has(src) ? 'checked' : '';
            label.innerHTML = `
                <input type="checkbox" ${checked} class="rounded border-outline-variant text-primary-container focus:ring-primary-container w-3.5 h-3.5" onchange="onFeedSourceCheck(this, '${src.replace(/'/g, "\\'")}')">
                <span class="flex-1 text-xs truncate">${src}</span>
                <span class="text-label-md text-on-surface-variant">${sourceFrequency[src]}</span>`;
            srcContainer.appendChild(label);
        });
        syncFeedSelectAll('Source');
    }

    // States — only show section if any states exist
    const stateSection = document.getElementById('feedStateFilterSection');
    const stContainer = document.getElementById('feedStateCheckboxes');
    if (stateSection && stContainer) {
        const stateKeys = Array.from(uniqueStates).sort();
        if (stateKeys.length > 0) {
            stateSection.classList.remove('hidden');
            stContainer.innerHTML = '';
            stateKeys.forEach(st => {
                const label = document.createElement('label');
                label.className = 'flex items-center gap-2 text-body-md text-on-surface cursor-pointer hover:bg-surface-container-low rounded px-1 py-0.5';
                const checked = feedSelectedStates.has(st) ? 'checked' : '';
                label.innerHTML = `
                    <input type="checkbox" ${checked} class="rounded border-outline-variant text-primary-container focus:ring-primary-container w-3.5 h-3.5" onchange="onFeedStateCheck(this, '${st.replace(/'/g, "\\'")}')">
                    <span class="flex-1 text-xs truncate">${st}</span>`;
                stContainer.appendChild(label);
            });
            syncFeedSelectAll('State');
        } else {
            stateSection.classList.add('hidden');
        }
    }
}

function syncFeedSelectAll(type) {
    const selected = type === 'State' ? feedSelectedStates : feedSelectedSources;
    const items = type === 'State' ? Array.from(uniqueStates) : Object.keys(sourceFrequency);
    const selectAllEl = document.getElementById(`feed${type}SelectAll`);
    if (selectAllEl) {
        selectAllEl.checked = items.length > 0 && items.every(i => selected.has(i));
        selectAllEl.indeterminate = !selectAllEl.checked && items.some(i => selected.has(i));
    }
}

function feedSelectAll(type, checked) {
    const selected = type === 'State' ? feedSelectedStates : feedSelectedSources;
    const items = type === 'State' ? Array.from(uniqueStates) : Object.keys(sourceFrequency);
    if (checked) {
        items.forEach(i => selected.add(i));
    } else {
        selected.clear();
    }
    feedCurrentPage = 0;
    renderFullFeed();
    buildFeedFilterCheckboxes();
}

function onFeedSourceCheck(checkbox, src) {
    if (checkbox.checked) feedSelectedSources.add(src);
    else feedSelectedSources.delete(src);
    feedCurrentPage = 0;
    renderFullFeed();
    syncFeedSelectAll('Source');
}

function onFeedStateCheck(checkbox, st) {
    if (checkbox.checked) feedSelectedStates.add(st);
    else feedSelectedStates.delete(st);
    feedCurrentPage = 0;
    renderFullFeed();
    syncFeedSelectAll('State');
}

function clearFeedFilters() {
    feedSelectedSources.clear();
    feedSelectedStates.clear();
    const fp = document.getElementById('feedDateFilter')?._flatpickr;
    if (fp) fp.clear();
    feedCurrentPage = 0;
    renderFullFeed();
    buildFeedFilterCheckboxes();
}

// Close popover on outside click
document.addEventListener('click', (e) => {
    const popover = document.getElementById('feedFilterPopover');
    const btn = document.getElementById('feedFilterToggleBtn');
    if (popover && !popover.classList.contains('hidden')) {
        if (!popover.contains(e.target) && btn && !btn.contains(e.target)) {
            popover.classList.add('hidden');
        }
    }
});

function getFilteredFeed() {
    const dateInput = document.getElementById('feedDateFilter')?.value || '';
    let startD = null, endD = null;
    if (dateInput.includes(' to ')) {
        const parts = dateInput.split(' to ');
        startD = new Date(parts[0]);
        endD = new Date(parts[1]);
        endD.setHours(23,59,59,999);
    }

    return collectedArticles.filter(a => {
        const srcOk = feedSelectedSources.size === 0 || feedSelectedSources.has(a.source);
        const articleStates = (a.states && a.states.length > 0) ? a.states : ['Sin localidad'];
        const stOk = feedSelectedStates.size === 0 || articleStates.some(s => feedSelectedStates.has(s));
        let dateOk = true;
        if (startD && endD && a.date) {
            let ad = new Date(a.date);
            if (!isNaN(ad.getTime())) {
                dateOk = ad >= startD && ad <= endD;
            }
        }
        return srcOk && stOk && dateOk;
    });
}

function renderFullFeed() {
    const list = document.getElementById('fullFeedList');
    const infoEl = document.getElementById('feedPaginationInfo');
    const clearBtn = document.getElementById('feedFilterClearBtn');
    if (!list) return;
    
    if (clearBtn) {
        const hasFilters = feedSelectedSources.size > 0 || feedSelectedStates.size > 0 || document.getElementById('feedDateFilter')?.value;
        clearBtn.classList.toggle('hidden', !hasFilters);
    }

    const filtered = getFilteredFeed();
    const totalPages = Math.max(1, Math.ceil(filtered.length / FEED_PAGE_SIZE));
    if (feedCurrentPage >= totalPages) feedCurrentPage = totalPages - 1;

    const start = feedCurrentPage * FEED_PAGE_SIZE;
    const pageItems = filtered.slice(start, start + FEED_PAGE_SIZE);

    list.innerHTML = '';
    pageItems.forEach(a => {
        const url = currentMode === 'mapping' ? (a.real_url || a.url) : a.url;
        const thumb = a.image || 'https://placehold.co/100x100/e2e8f0/475569?text=News';
        const hasStates = a.states && a.states.length > 0;
        const locationText = hasStates ? a.states.join(', ') : 'Sin localidad';
        const locationCls = hasStates ? 'text-tertiary font-medium' : 'text-on-surface-variant';

        const item = document.createElement('a');
        item.href = url;
        item.target = '_blank';
        item.className = 'flex items-start gap-3 p-md hover:bg-primary-container/5 transition-colors cursor-pointer';
        item.innerHTML = `
            <div class="flex-1 min-w-0">
                <p class="text-body-md font-medium text-on-background leading-snug line-clamp-2 mb-1">${a.title}</p>
                <div class="flex items-center gap-1.5 text-label-md text-on-surface-variant flex-wrap">
                    <span class="truncate max-w-[90px]">${a.source}</span><span>·</span><span>${a.date}</span>
                </div>
                <span class="text-xs ${locationCls} mt-0.5 block truncate">${locationText}</span>
            </div>
            <div class="w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 bg-surface-container">
                <img src="${thumb}" alt="" class="w-full h-full object-cover" onerror="this.src='https://placehold.co/100x100/e2e8f0/475569?text=News'">
            </div>`;
        list.appendChild(item);
    });

    if (infoEl) infoEl.textContent = filtered.length ? `${start + 1}–${Math.min(start + FEED_PAGE_SIZE, filtered.length)} of ${filtered.length}` : '';
    const prevBtn = document.getElementById('feedPrevBtn');
    const nextBtn = document.getElementById('feedNextBtn');
    if (prevBtn) prevBtn.disabled = feedCurrentPage === 0;
    if (nextBtn) nextBtn.disabled = feedCurrentPage >= totalPages - 1;

    updateNewsSummarySubtitle(filtered);
}

function updateNewsSummarySubtitle(articles = null) {
    const subtitleEl = document.getElementById('news-summary-subtitle');
    if (!subtitleEl) return;

    const data = articles !== null ? articles : getFilteredFeed();
    if (!data || data.length === 0) {
        subtitleEl.textContent = 'No dates available';
        return;
    }

    const validDates = [];
    data.forEach(a => {
        if (a.date) {
            const d = new Date(a.date);
            if (!isNaN(d.getTime())) {
                validDates.push(d);
            }
        }
    });

    if (validDates.length === 0) {
        subtitleEl.textContent = 'No dates available';
        return;
    }

    validDates.sort((a, b) => a.getTime() - b.getTime());
    const minDate = validDates[0];
    const maxDate = validDates[validDates.length - 1];

    const formatDate = (d) => {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const m = months[d.getMonth()];
        const day = String(d.getDate()).padStart(2, '0');
        const y = d.getFullYear();
        return `${m} ${day}, ${y}`;
    };

    const sameDay = minDate.getFullYear() === maxDate.getFullYear() &&
                    minDate.getMonth() === maxDate.getMonth() &&
                    minDate.getDate() === maxDate.getDate();

    if (sameDay) {
        subtitleEl.textContent = formatDate(minDate);
    } else {
        subtitleEl.textContent = `${formatDate(minDate)} - ${formatDate(maxDate)}`;
    }
}

function feedPageChange(delta) {
    const filtered = getFilteredFeed();
    const totalPages = Math.max(1, Math.ceil(filtered.length / FEED_PAGE_SIZE));
    feedCurrentPage = Math.max(0, Math.min(feedCurrentPage + delta, totalPages - 1));
    renderFullFeed();
}

// ============================================
// Analytics Tab — Multi-Checkbox Filter Dropdowns
// ============================================

let analyticsSelectedStates  = new Set();
let analyticsSelectedSources = new Set();

function toggleAnalyticsDropdown(type) {
    const dd = document.getElementById(`analytics${type}Dropdown`);
    const otherType = type === 'State' ? 'Source' : 'State';
    const otherDd = document.getElementById(`analytics${otherType}Dropdown`);
    if (otherDd) otherDd.classList.add('hidden');
    if (!dd) return;
    const wasHidden = dd.classList.contains('hidden');
    dd.classList.toggle('hidden');
    if (wasHidden) buildAnalyticsCheckboxes(type);
}

document.addEventListener('click', (e) => {
    ['State', 'Source'].forEach(type => {
        const wrap = document.getElementById(`analytics${type}DropdownWrap`);
        const dd   = document.getElementById(`analytics${type}Dropdown`);
        if (dd && !dd.classList.contains('hidden') && wrap && !wrap.contains(e.target)) {
            dd.classList.add('hidden');
        }
    });
});

function buildAnalyticsCheckboxes(type) {
    const container = document.getElementById(`analytics${type}Checkboxes`);
    if (!container) return;
    container.innerHTML = '';

    const items = type === 'State'
        ? Array.from(uniqueStates).sort()
        : Object.keys(sourceFrequency).sort();

    const selected = type === 'State' ? analyticsSelectedStates : analyticsSelectedSources;

    items.forEach(item => {
        const label = document.createElement('label');
        label.className = 'flex items-center gap-2 py-1 px-1 hover:bg-surface-container-low rounded cursor-pointer';
        const count = type === 'State' ? (stateFrequency[item] || '') : (sourceFrequency[item] || '');
        label.innerHTML = `
            <input type="checkbox" ${selected.has(item) ? 'checked' : ''} class="w-3.5 h-3.5"
                onchange="onAnalyticsCheck('${type}', '${item.replace(/'/g,"\\'")}', this.checked)">
            <span class="flex-1 text-xs text-on-surface truncate">${item}</span>
            <span class="text-label-md text-on-surface-variant">${count}</span>`;
        container.appendChild(label);
    });

    // Sync "Select All" checkbox state
    const selectAllEl = document.getElementById(`analytics${type}SelectAll`);
    if (selectAllEl) {
        selectAllEl.checked = items.length > 0 && items.every(i => selected.has(i));
        selectAllEl.indeterminate = !selectAllEl.checked && items.some(i => selected.has(i));
    }
}

function onAnalyticsCheck(type, item, checked) {
    const selected = type === 'State' ? analyticsSelectedStates : analyticsSelectedSources;
    if (checked) selected.add(item); else selected.delete(item);
    updateAnalyticsTriggerLabel(type);
    applyAnalyticsFilters();
    // Sync select-all state
    const items = type === 'State' ? Array.from(uniqueStates) : Object.keys(sourceFrequency);
    const selectAllEl = document.getElementById(`analytics${type}SelectAll`);
    if (selectAllEl) {
        selectAllEl.checked = items.length > 0 && items.every(i => selected.has(i));
        selectAllEl.indeterminate = !selectAllEl.checked && items.some(i => selected.has(i));
    }
}

function analyticsSelectAll(type, checked) {
    const selected = type === 'State' ? analyticsSelectedStates : analyticsSelectedSources;
    const items = type === 'State' ? Array.from(uniqueStates) : Object.keys(sourceFrequency);
    if (checked) items.forEach(i => selected.add(i));
    else selected.clear();
    buildAnalyticsCheckboxes(type);
    updateAnalyticsTriggerLabel(type);
    applyAnalyticsFilters();
}

function updateAnalyticsTriggerLabel(type) {
    const selected = type === 'State' ? analyticsSelectedStates : analyticsSelectedSources;
    const label = document.getElementById(`analytics${type}TriggerLabel`);
    if (!label) return;
    if (selected.size === 0) label.textContent = `All ${type}s`;
    else if (selected.size === 1) label.textContent = Array.from(selected)[0];
    else label.textContent = `${selected.size} ${type}s`;
}

function populateAnalyticsFilters() {
    // Just rebuild open dropdowns; labels stay current via onAnalyticsCheck
    ['State', 'Source'].forEach(type => {
        const dd = document.getElementById(`analytics${type}Dropdown`);
        if (dd && !dd.classList.contains('hidden')) buildAnalyticsCheckboxes(type);
    });
}

function applyAnalyticsFilters() {
    const dateInput = document.getElementById('analyticsDateFilter')?.value || '';
    let startD = null, endD = null;
    if (dateInput.includes(' to ')) {
        const parts = dateInput.split(' to ');
        startD = new Date(parts[0]);
        endD = new Date(parts[1]);
        endD.setHours(23,59,59,999);
    }

    const filtered = collectedArticles.filter(a => {
        const articleStates = (a.states && a.states.length > 0) ? a.states : ['Sin localidad'];
        const stOk  = analyticsSelectedStates.size  === 0 || articleStates.some(s => analyticsSelectedStates.has(s));
        const srcOk = analyticsSelectedSources.size === 0 || analyticsSelectedSources.has(a.source);
        let dateOk = true;
        if (startD && endD && a.date) {
            let ad = new Date(a.date);
            if (!isNaN(ad.getTime())) {
                dateOk = ad >= startD && ad <= endD;
            }
        }
        return stOk && srcOk && dateOk;
    });

    let ftotal = 0, fStates = new Set(), fStateCounts = {}, fSrcCounts = {};
    filtered.forEach(a => {
        ftotal++;
        if (a.source) fSrcCounts[a.source] = (fSrcCounts[a.source] || 0) + 1;
        const articleStates = (a.states && a.states.length > 0) ? a.states : ['Sin localidad'];
        const isolatedStates = analyticsSelectedStates.size === 0
            ? articleStates
            : articleStates.filter(s => analyticsSelectedStates.has(s));

        isolatedStates.forEach(s => {
            fStates.add(s);
            fStateCounts[s] = (fStateCounts[s] || 0) + 1;
        });
    });

    const topState = Object.entries(fStateCounts).sort((a, b) => b[1] - a[1])[0];
    const topSrc   = Object.entries(fSrcCounts).sort((a, b)   => b[1] - a[1])[0];

    const elTotal     = document.getElementById('kpiTotal');
    const elCoverage  = document.getElementById('kpiCoverage');
    const elEpicenter = document.getElementById('kpiEpicenter');
    const elTopSource = document.getElementById('kpiTopSource');
    if (elTotal)     elTotal.textContent     = ftotal;
    if (elCoverage)  elCoverage.textContent  = fStates.size;
    if (elEpicenter) elEpicenter.textContent = topState ? topState[0] : '—';
    if (elTopSource) elTopSource.textContent = topSrc   ? topSrc[0]   : '—';

    if (typeof resetMapState === 'function') resetMapState();
    let allFilteredStates = [];
    filtered.forEach(a => {
        const articleStates = (a.states && a.states.length > 0) ? a.states : ['Sin localidad'];
        const isolatedStates = analyticsSelectedStates.size === 0
            ? articleStates
            : articleStates.filter(s => analyticsSelectedStates.has(s));
        allFilteredStates.push(...isolatedStates);
    });
    if (typeof updateMap === 'function' && allFilteredStates.length > 0) {
        updateMap(allFilteredStates);
    }

    if (typeof resetAnalytics === 'function') resetAnalytics();
    filtered.forEach(a => {
        const articleStates = (a.states && a.states.length > 0) ? a.states : ['Sin localidad'];
        const isolatedStates = analyticsSelectedStates.size === 0
            ? articleStates
            : articleStates.filter(s => analyticsSelectedStates.has(s));

        if (typeof updateSourcesBar === 'function') updateSourcesBar(a.source);
        if (typeof updateStatesBar  === 'function' && isolatedStates.length > 0) updateStatesBar(isolatedStates);
        if (typeof updateTimeline   === 'function') updateTimeline(a.date);
    });

    renderTopStories(filtered);
    feedCurrentPage = 0;
    renderFullFeed();

    const filterBanner = document.getElementById('filterBanner');
    if (filterBanner) {
        if (analyticsSelectedStates.size > 0 || analyticsSelectedSources.size > 0) {
            filterBanner.style.display = 'flex';
            let labelParts = [];
            if (analyticsSelectedStates.size > 0) labelParts.push(`Estado: <b>${Array.from(analyticsSelectedStates).join(', ')}</b>`);
            if (analyticsSelectedSources.size > 0) labelParts.push(`Fuente: <b>${Array.from(analyticsSelectedSources).join(', ')}</b>`);
            filterBanner.innerHTML = `<span>Filtrando por ${labelParts.join(' | ')}</span> 
            <button onclick="resetAnalyticsFilters()" style="background:none; border:none; color:#ea4335; cursor:pointer; font-weight:bold; padding:0; margin-left:8px;">✖ Quitar Filtro</button>`;
        } else {
            filterBanner.style.display = 'none';
        }
    }
}

function resetAnalyticsFilters() {
    analyticsSelectedStates.clear();
    analyticsSelectedSources.clear();
    feedSelectedStates.clear();
    feedSelectedSources.clear();
    ['State', 'Source'].forEach(type => {
        updateAnalyticsTriggerLabel(type);
        syncFeedSelectAll(type);
        const dd = document.getElementById(`analytics${type}Dropdown`);
        if (dd) dd.classList.add('hidden');
    });
    applyAnalyticsFilters();
}

function updateKPIs(article) {
    totalArticles++;
    
    // Total Articles
    const elTotal = document.getElementById('kpiTotal');
    if (elTotal) elTotal.textContent = totalArticles;

    // Source frequency
    if (article.source) {
        sourceFrequency[article.source] = (sourceFrequency[article.source] || 0) + 1;
    }

    // State frequency (including "Sin localidad")
    const statesToTrack = (article.states && article.states.length > 0) ? article.states : ['Sin localidad'];
    statesToTrack.forEach(s => {
        uniqueStates.add(s);
        stateFrequency[s] = (stateFrequency[s] || 0) + 1;
    });

    // Coverage
    const elCoverage = document.getElementById('kpiCoverage');
    if (elCoverage) elCoverage.textContent = uniqueStates.size;

    // Top Epicenter
    const topState = Object.entries(stateFrequency).sort((a, b) => b[1] - a[1])[0];
    const elEpicenter = document.getElementById('kpiEpicenter');
    if (elEpicenter) elEpicenter.textContent = topState ? topState[0] : '—';

    // Top Source
    const topSrc = Object.entries(sourceFrequency).sort((a, b) => b[1] - a[1])[0];
    const elTopSource = document.getElementById('kpiTopSource');
    if (elTopSource) elTopSource.textContent = topSrc ? topSrc[0] : '—';

    // Keep analytics toolbar dropdowns in sync
    if (typeof populateAnalyticsFilters === 'function') populateAnalyticsFilters();
}

// ============================================
// Filtro Cruzado Interactivo (BI Logic)
// ============================================

window.applyGlobalFilter = function(filterType, filterValue) {
    if (!filterType || !filterValue) {
        resetAnalyticsFilters();
        return;
    }

    if (filterType.toLowerCase() === 'state') {
        if (analyticsSelectedStates.has(filterValue) && analyticsSelectedStates.size === 1) {
            analyticsSelectedStates.clear();
            feedSelectedStates.clear();
        } else {
            analyticsSelectedStates.clear();
            analyticsSelectedStates.add(filterValue);
            feedSelectedStates.clear();
            feedSelectedStates.add(filterValue);
        }
        updateAnalyticsTriggerLabel('State');
        syncFeedSelectAll('State');
    } else if (filterType.toLowerCase() === 'source') {
        if (analyticsSelectedSources.has(filterValue) && analyticsSelectedSources.size === 1) {
            analyticsSelectedSources.clear();
            feedSelectedSources.clear();
        } else {
            analyticsSelectedSources.clear();
            analyticsSelectedSources.add(filterValue);
            feedSelectedSources.clear();
            feedSelectedSources.add(filterValue);
        }
        updateAnalyticsTriggerLabel('Source');
        syncFeedSelectAll('Source');
    }

    applyAnalyticsFilters();
};

// ============================================
// Inicialización de Flatpickr Date Range Picker y Filtros
// ============================================
function initDatePicker() {
    if (typeof flatpickr === 'undefined') return;

    // Main header search date range
    const mainInput = document.getElementById('dateRange');
    if (mainInput) {
        flatpickr(mainInput, {
            mode: "range",
            dateFormat: "Y-m-d",
            allowInput: false,
            onChange: function() {
                mainInput.dispatchEvent(new Event('input', { bubbles: true }));
                mainInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
    }

    // Feed date filter (client side)
    const feedInput = document.getElementById('feedDateFilter');
    if (feedInput) {
        flatpickr(feedInput, {
            mode: "range",
            dateFormat: "Y-m-d",
            allowInput: false,
            onChange: function(selectedDates) {
                if (selectedDates.length === 0 || selectedDates.length === 2) {
                    feedCurrentPage = 0;
                    renderFullFeed();
                }
            }
        });
    }

    // Analytics date filter (client side)
    const analyticsInput = document.getElementById('analyticsDateFilter');
    if (analyticsInput) {
        flatpickr(analyticsInput, {
            mode: "range",
            dateFormat: "Y-m-d",
            allowInput: false,
            onChange: function(selectedDates) {
                if (selectedDates.length === 0 || selectedDates.length === 2) {
                    applyAnalyticsFilters();
                }
            }
        });
    }
}

function initSearchAndFilters() {
    const mainSearchInput = document.getElementById('mainSearchInput');
    const filterDropdown = document.getElementById('filterDropdown');
    const searchFilterBtn = document.getElementById('searchFilterBtn');
    const closeFilterBtn = document.getElementById('closeFilterBtn');
    const applyFiltersBtn = document.getElementById('applyFiltersBtn');
    const searchBarContainer = document.getElementById('searchBarContainer');

    if (mainSearchInput && filterDropdown) {
        const openDropdown = () => {
            filterDropdown.classList.remove('hidden');
        };

        mainSearchInput.addEventListener('focus', openDropdown);
        mainSearchInput.addEventListener('click', openDropdown);

        if (searchFilterBtn) {
            searchFilterBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                filterDropdown.classList.toggle('hidden');
            });
        }

        if (closeFilterBtn) {
            closeFilterBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                filterDropdown.classList.add('hidden');
            });
        }

        document.addEventListener('click', (e) => {
            const isClickInsidePanel = filterDropdown.contains(e.target);
            const isClickInsideSearchBar = searchBarContainer ? searchBarContainer.contains(e.target) : (mainSearchInput.contains(e.target) || (searchFilterBtn && searchFilterBtn.contains(e.target)));
            const isFlatpickrCalendar = e.target.closest && e.target.closest('.flatpickr-calendar');

            if (!isClickInsidePanel && !isClickInsideSearchBar && !isFlatpickrCalendar) {
                filterDropdown.classList.add('hidden');
            }
        });

        // Clear validation errors on typing
        const nqueriesInput = document.getElementById('nqueriesInput');
        const searchWarning = document.getElementById('search-warning');
        const searchBarWrapper = document.getElementById('searchBarWrapper');

        const clearValidationErrors = () => {
            if (searchWarning) searchWarning.classList.add('hidden');
            if (searchBarWrapper) {
                searchBarWrapper.classList.remove('border-red-500', 'ring-2', 'ring-red-500', 'animate-shake');
            }
            if (nqueriesInput) {
                nqueriesInput.classList.remove('border-red-500', 'ring-2', 'ring-red-500', 'animate-shake');
            }
        };

        if (mainSearchInput) mainSearchInput.addEventListener('input', clearValidationErrors);
        if (nqueriesInput) nqueriesInput.addEventListener('input', clearValidationErrors);

        // Global Enter listener for all inputs inside search area
        const searchInputs = searchBarContainer ? searchBarContainer.querySelectorAll('input') : [mainSearchInput];
        searchInputs.forEach(input => {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    fetchDiscovery();
                }
            });
        });
    }

    if (applyFiltersBtn) {
        applyFiltersBtn.addEventListener('click', (e) => {
            e.preventDefault();
            fetchDiscovery();
        });
    }
}

// ============================================
// Tab Navigation Routing
// ============================================
function switchTab(tabId) {
    const views = {
        'main': document.getElementById('view-main'),
        'analytics': document.getElementById('view-analytics'),
        'docs': document.getElementById('view-docs'),
        'manual': document.getElementById('view-manual')
    };
    
    const tabs = {
        'main': document.getElementById('tab-main'),
        'analytics': document.getElementById('tab-analytics'),
        'docs': document.getElementById('tab-docs'),
        'manual': document.getElementById('tab-manual')
    };

    // Hide all views, show selected
    Object.keys(views).forEach(key => {
        if (views[key]) {
            if (key === tabId) {
                views[key].classList.remove('hidden');
            } else {
                views[key].classList.add('hidden');
            }
        }
    });
    
    // Update tab styles
    Object.keys(tabs).forEach(key => {
        if (tabs[key]) {
            if (key === tabId) {
                tabs[key].classList.add('text-primary', 'border-b-2', 'border-primary');
                tabs[key].classList.remove('text-on-surface-variant', 'hover:text-primary');
            } else {
                tabs[key].classList.add('text-on-surface-variant', 'hover:text-primary');
                tabs[key].classList.remove('text-primary', 'border-b-2', 'border-primary');
            }
        }
    });

    if (tabId === 'analytics') {
        // Populate toolbar dropdowns with current session data
        if (typeof populateAnalyticsFilters === 'function') populateAnalyticsFilters();
        // Ensure Leaflet map resizes correctly when becoming visible
        if (typeof initMap === 'function') initMap();
        if (typeof map !== 'undefined' && map !== null) {
            setTimeout(() => {
                map.invalidateSize();
            }, 100);
        }
    }
}

async function initCountrySelector() {
    const container = document.getElementById('countrySegmentedControl');
    if (!container) return;

    try {
        const res = await fetch('/api/available-maps');
        const maps = await res.json();
        
        container.innerHTML = maps.map(m => `
            <label class="flex-1 text-center cursor-pointer relative">
                <input type="radio" name="countryToggle" value="${m.key}" class="peer sr-only">
                <div class="py-1 px-2 text-sm rounded-md peer-checked:bg-white peer-checked:text-primary peer-checked:shadow-sm text-on-surface-variant font-medium transition-all">
                    ${m.country_name}
                </div>
            </label>
        `).join('');

        // Remove error pulse when interacted
        container.addEventListener('change', () => {
            container.classList.remove('border-red-500', 'ring-2', 'ring-red-500', 'animate-shake');
        });
    } catch (e) {
        console.error("Failed to load maps config", e);
    }
}

function initClearButtons() {
    document.querySelectorAll('.clear-btn').forEach(btn => {
        const input = btn.previousElementSibling;
        if (!input || input.tagName !== 'INPUT') return;
        
        const toggleClear = () => {
            if (input.value && input.value.trim().length > 0) {
                btn.classList.remove('hidden');
            } else {
                btn.classList.add('hidden');
            }
        };
        
        input.addEventListener('input', toggleClear);
        input.addEventListener('change', toggleClear);
        toggleClear(); // Initial state
        
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (input._flatpickr) {
                input._flatpickr.clear();
            } else {
                input.value = '';
            }
            input.focus();
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            toggleClear();
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initDatePicker();
    initSearchAndFilters();
    initCountrySelector();
    initClearButtons();
    switchTab('main');

    // Initialize Leaflet map immediately so tiles load before any fetch
    if (typeof initMap === 'function') initMap();
});