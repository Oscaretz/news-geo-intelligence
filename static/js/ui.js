
function formatTemporal(isoString) {
    if (!isoString) return '<span class="text-on-surface-variant text-sm">-</span>';
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '<span class="text-on-surface-variant text-sm">-</span>';

    const now = new Date();
    const diffMs = Math.max(0, now - date);
    const diffHrs = diffMs / (1000 * 60 * 60);

    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    const fullLocal = `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
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

let extractionTimer = null;
let extractionStartTime = 0;
let fakeProgressInterval = null;
let currentProgressPct = 0;

function updateStatus(message) {
    const container = document.getElementById('progressContainer');
    const statusText = document.getElementById('progressStatusText');
    const timerEl = document.getElementById('progressTimer');
    const bar = document.getElementById('progressBar');
    const spinner = document.getElementById('progressSpinner');
    if (!container) return;

    if (container.classList.contains('hidden')) {
        container.classList.remove('hidden');
        setTimeout(() => container.classList.remove('opacity-0'), 10);
        
        currentProgressPct = 0;
        if (bar) {
            bar.classList.replace('bg-red-500', 'bg-primary');
            bar.classList.replace('bg-green-500', 'bg-primary');
            bar.style.width = '0%';
        }
        if (spinner) {
            spinner.classList.add('animate-spin');
            spinner.textContent = 'sync';
            spinner.classList.remove('text-green-500', 'text-red-500');
            spinner.classList.add('text-primary');
        }
        
        if (extractionTimer) clearInterval(extractionTimer);
        extractionStartTime = Date.now();
        if (timerEl) timerEl.textContent = '00:00';
        extractionTimer = setInterval(() => {
            const elapsed = Math.floor((Date.now() - extractionStartTime) / 1000);
            const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
            const secs = String(elapsed % 60).padStart(2, '0');
            if (timerEl) timerEl.textContent = `${mins}:${secs}`;
        }, 1000);
        
        if (fakeProgressInterval) clearInterval(fakeProgressInterval);
        fakeProgressInterval = setInterval(() => {
            if (currentProgressPct < 85) {
                currentProgressPct += Math.random() * 8;
                if (currentProgressPct > 85) currentProgressPct = 85;
                if (bar) bar.style.width = `${currentProgressPct}%`;
            }
        }, 600);
    }

    let parsedMsg = message;
    if (message.includes('Resolving URL for:') || message.includes('Resolving URL')) {
        const title = message.replace(/^.*Resolving URL for:\s*/i, '').replace(/\.\.\.$/, '').trim();
        parsedMsg = `Analyzing: ${title}...`;
    }
    
    if (statusText) statusText.textContent = parsedMsg;

    const lowerMsg = message.toLowerCase();
    const isError = message.includes('Error') || message.includes('❌') || lowerMsg.includes('failed');
    const isComplete = isError || 
                       message.includes('éxito') || 
                       lowerMsg.includes('exito') || 
                       lowerMsg.includes('complete') || 
                       lowerMsg.includes('completado') || 
                       lowerMsg.includes('success') || 
                       lowerMsg.includes('iniciado');
    if (isComplete) {
        if (extractionTimer) clearInterval(extractionTimer);
        if (fakeProgressInterval) clearInterval(fakeProgressInterval);
        if (bar) bar.style.width = '100%';
        
        const isError = message.includes('Error') || message.includes('❌');
        
        if (spinner) {
            spinner.classList.remove('animate-spin', 'text-primary');
            if (isError) {
                spinner.textContent = 'error';
                spinner.classList.add('text-red-500');
                if (bar) bar.classList.replace('bg-primary', 'bg-red-500');
            } else {
                spinner.textContent = 'check_circle';
                spinner.classList.add('text-green-500');
                if (bar) bar.classList.replace('bg-primary', 'bg-green-500');
            }
        }
        
        setTimeout(() => {
            container.classList.add('opacity-0');
            setTimeout(() => {
                container.classList.add('hidden');
                if (bar) {
                    bar.style.width = '0%';
                    bar.classList.replace('bg-red-500', 'bg-primary');
                    bar.classList.replace('bg-green-500', 'bg-primary');
                }
            }, 500);
        }, 1500);
    }
}

function completeProgress(isError = false) {
    const container = document.getElementById('progressContainer');
    if (!container) return;
    if (extractionTimer) clearInterval(extractionTimer);
    if (fakeProgressInterval) clearInterval(fakeProgressInterval);
    const bar = document.getElementById('progressBar');
    const spinner = document.getElementById('progressSpinner');
    if (bar) bar.style.width = '100%';
    if (spinner) {
        spinner.classList.remove('animate-spin', 'text-primary');
        if (isError) {
            spinner.textContent = 'error';
            spinner.classList.add('text-red-500');
            if (bar) bar.classList.replace('bg-primary', 'bg-red-500');
        } else {
            spinner.textContent = 'check_circle';
            spinner.classList.add('text-green-500');
            if (bar) bar.classList.replace('bg-primary', 'bg-green-500');
        }
    }
    setTimeout(() => {
        container.classList.add('opacity-0');
        setTimeout(() => {
            container.classList.add('hidden');
            if (bar) {
                bar.style.width = '0%';
                bar.classList.replace('bg-red-500', 'bg-primary');
                bar.classList.replace('bg-green-500', 'bg-primary');
            }
        }, 500);
    }, 1500);
}
window.completeProgress = completeProgress;

function renderSkeletons() {
    const feed = document.getElementById('articlesFeed');
    const list = document.getElementById('fullFeedList');
    
    const topSkeleton = `
        <article class="animate-pulse flex flex-col w-full group cursor-pointer pt-md border-t border-outline-variant/20 first:border-0 first:pt-0">
            <div class="bg-gray-200 dark:bg-gray-700 h-44 rounded-lg mb-3 w-full"></div>
            <div class="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
            <div class="h-4 bg-gray-200 rounded w-1/2 mb-3"></div>
            <div class="h-3 bg-gray-200 rounded w-1/4"></div>
        </article>`;
    
    const listSkeleton = `
        <div class="flex items-start gap-3 p-md animate-pulse w-full">
            <div class="flex-1 min-w-0">
                <div class="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                <div class="h-4 bg-gray-200 rounded w-1/2 mb-3"></div>
                <div class="h-3 bg-gray-200 rounded w-1/4"></div>
            </div>
            <div class="w-14 h-14 rounded-lg bg-gray-200 flex-shrink-0"></div>
        </div>`;

    if (feed) feed.innerHTML = topSkeleton.repeat(2);
    if (list) list.innerHTML = listSkeleton.repeat(5);
}

function resetUI(mode) {
    currentMode = mode;
    totalArticles = 0;
    uniqueStates = new Set();
    stateFrequency = {};
    sourceFrequency = {};
    collectedArticles = [];
    currentFilter = null;



    // Dashboard
    const dashboard = document.getElementById('dashboard');
    dashboard.style.display = 'flex';
    document.getElementById('actionButtons').style.display = 'none';
    feedCurrentPage = 0;
    feedSelectedSources = new Set();
    feedSelectedStates = new Set();
    analyticsSelectedStates  = new Set();
    analyticsSelectedSources = new Set();
    currentFilter = null;

    const analyticsDate = document.getElementById('analyticsDateFilter');
    if (analyticsDate) {
        if (analyticsDate._flatpickr) analyticsDate._flatpickr.clear();
        analyticsDate.value = '';
    }
    const resetBtn = document.getElementById('analyticsResetBtn');
    if (resetBtn) resetBtn.classList.add('hidden');
    ['State', 'Source'].forEach(type => updateAnalyticsTriggerLabel(type));
    
    renderSkeletons();
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

function renderTopStories(articles = null, emptyMessage = null) {
    const feed = document.getElementById('articlesFeed');
    if (!feed) return;
    feed.innerHTML = '';

    const sourceData = articles || collectedArticles;

    if (sourceData.length === 0) {
        const placeholder = document.createElement('article');
        placeholder.id = 'articlesPlaceholder';
        if (emptyMessage) {
            placeholder.className = 'flex flex-col items-center justify-center p-8 text-center text-on-surface-variant border border-dashed border-outline-variant/40 rounded-xl bg-surface-container-lowest';
            placeholder.innerHTML = `
                <span class="material-symbols-outlined text-4xl mb-2 text-on-surface-variant/40">search_off</span>
                <p class="text-body-md font-medium text-on-surface mb-1">No articles found</p>
                <p class="text-xs text-on-surface-variant">${emptyMessage}</p>
            `;
        } else {
            placeholder.className = 'group flex flex-col';
            placeholder.innerHTML = `
                <div class="overflow-hidden rounded-xl mb-3 h-72 bg-surface-container flex flex-col items-center justify-center text-on-surface-variant/40 border border-dashed border-outline-variant/40">
                    <span class="material-symbols-outlined text-5xl mb-2">newspaper</span>
                    <span class="text-xs font-medium uppercase tracking-wider">News Preview</span>
                </div>
                <h3 class="text-title-md font-title-md text-on-surface mb-1 leading-snug">Waiting for search...</h3>
                <p class="text-body-md text-on-surface-variant mb-2 leading-relaxed">Enter a keyword, topic, or entity in the search bar above to fetch and analyze news articles in real time.</p>
                <div class="flex items-center gap-2 text-label-md text-on-surface-variant">
                    <span class="px-2 py-0.5 rounded bg-surface-container text-xs font-medium text-on-surface-variant">AI News Explorer</span>
                    <span>·</span>
                    <span>Today</span>
                </div>
            `;
        }
        feed.appendChild(placeholder);
        return;
    }

    const recent = sourceData.slice(-2).reverse();

    if (recent[0]) {
        const a = recent[0];
        const url = currentMode === 'mapping' ? (a.real_url || a.url) : a.url;
        const imgUrl = a.image_url || a.image || 'https://placehold.co/600x400/e2e8f0/475569?text=News+Image';
        const hasStates = a.states && a.states.length > 0;
        const locationText = hasStates ? a.states.join(', ') : 'Sin localidad';
        const locationCls = hasStates ? 'text-tertiary font-medium' : 'text-on-surface-variant';

        const card = document.createElement('article');
        card.className = 'group cursor-pointer';
        card.innerHTML = `
            <a href="${url}" target="_blank" class="block">
                <div class="overflow-hidden rounded-xl mb-3 h-72 bg-surface-container">
                    <img src="${imgUrl}"
                         alt="News" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                         loading="lazy"
                         onerror="this.onerror=null; this.src='https://placehold.co/600x400/e2e8f0/475569?text=News+Image';">
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

    if (filtered.length === 0) {
        list.innerHTML = `
            <div class="p-6 text-center text-on-surface-variant flex flex-col items-center justify-center">
                <span class="material-symbols-outlined text-4xl mb-2 text-on-surface-variant/40">search_off</span>
                <p class="text-body-md font-medium text-on-surface mb-1">No articles found</p>
                <p class="text-xs text-on-surface-variant">No articles found matching your criteria.</p>
            </div>`;
        if (infoEl) infoEl.textContent = '0 of 0';
        const prevBtn = document.getElementById('feedPrevBtn');
        const nextBtn = document.getElementById('feedNextBtn');
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        updateNewsSummarySubtitle(filtered);
        return;
    }

    pageItems.forEach(a => {
        const url = currentMode === 'mapping' ? (a.real_url || a.url) : a.url;
        const thumb = a.image_url || a.image || 'https://placehold.co/100x100/e2e8f0/475569?text=News';
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
                <img src="${thumb}" alt="" class="w-full h-full object-cover" loading="lazy" onerror="this.onerror=null; this.src='https://placehold.co/100x100/e2e8f0/475569?text=News';">
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
    const dateInput = (document.getElementById('analyticsDateFilter')?.value || '').trim();
    let startD = null, endD = null;
    if (dateInput.includes(' to ')) {
        const parts = dateInput.split(' to ');
        startD = new Date(parts[0]);
        endD = new Date(parts[1]);
        endD.setHours(23,59,59,999);
    } else if (dateInput !== '') {
        startD = new Date(dateInput);
        endD = new Date(dateInput);
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

    const hasActiveFilter = analyticsSelectedStates.size > 0 || analyticsSelectedSources.size > 0 || dateInput !== '' || Boolean(currentFilter);
    const resetBtn = document.getElementById('analyticsResetBtn');
    if (resetBtn) {
        resetBtn.classList.toggle('hidden', !hasActiveFilter);
    }

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
    currentFilter = null;

    const analyticsDate = document.getElementById('analyticsDateFilter');
    if (analyticsDate) {
        if (analyticsDate._flatpickr) {
            analyticsDate._flatpickr.clear();
        }
        analyticsDate.value = '';
    }

    const feedDate = document.getElementById('feedDateFilter');
    if (feedDate) {
        if (feedDate._flatpickr) {
            feedDate._flatpickr.clear();
        }
        feedDate.value = '';
    }

    ['State', 'Source'].forEach(type => {
        updateAnalyticsTriggerLabel(type);
        syncFeedSelectAll(type);
        const dd = document.getElementById(`analytics${type}Dropdown`);
        if (dd) dd.classList.add('hidden');
        buildAnalyticsCheckboxes(type);
    });

    if (typeof centerMap === 'function') {
        centerMap();
    }

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
            currentFilter = null;
        } else {
            analyticsSelectedStates.clear();
            analyticsSelectedStates.add(filterValue);
            feedSelectedStates.clear();
            feedSelectedStates.add(filterValue);
            currentFilter = { type: 'state', value: filterValue };
        }
        updateAnalyticsTriggerLabel('State');
        syncFeedSelectAll('State');
    } else if (filterType.toLowerCase() === 'source') {
        if (analyticsSelectedSources.has(filterValue) && analyticsSelectedSources.size === 1) {
            analyticsSelectedSources.clear();
            feedSelectedSources.clear();
            currentFilter = null;
        } else {
            analyticsSelectedSources.clear();
            analyticsSelectedSources.add(filterValue);
            feedSelectedSources.clear();
            feedSelectedSources.add(filterValue);
            currentFilter = { type: 'source', value: filterValue };
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
            },
            onClose: function(selectedDates) {
                if (selectedDates.length === 1) {
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
        'manual': document.getElementById('view-manual'),
        'history': document.getElementById('view-history'),
        'jobs': document.getElementById('view-jobs')
    };
    
    const tabs = {
        'main': document.getElementById('tab-main'),
        'analytics': document.getElementById('tab-analytics'),
        'docs': document.getElementById('tab-docs'),
        'manual': document.getElementById('tab-manual'),
        'history': document.getElementById('tab-history'),
        'jobs': document.getElementById('tab-jobs')
    };

    // Hide all views, show selected
    Object.values(views).forEach(v => {
        if(v) v.classList.add('hidden');
    });
    if(views[tabId]) views[tabId].classList.remove('hidden');

    // Update active state on buttons (move underline and update text styling)
    Object.keys(tabs).forEach(key => {
        const t = tabs[key];
        if (t) {
            if (key === tabId) {
                t.classList.add('text-primary', 'border-primary', 'font-medium');
                t.classList.remove('text-on-surface-variant', 'border-transparent', 'bg-primary-container/10');
            } else {
                t.classList.remove('text-primary', 'border-primary', 'font-medium', 'bg-primary-container/10');
                t.classList.add('text-on-surface-variant', 'border-transparent');
            }
        }
    });
    
    // Trigger specific tab logic
    if (tabId === 'history' && typeof loadHistory === 'function') {
        loadHistory();
    }
    if (tabId === 'jobs' && typeof fetchJobs === 'function') {
        fetchJobs();
    }

    if (tabId === 'analytics') {
        // Populate toolbar dropdowns with current session data
        if (typeof populateAnalyticsFilters === 'function') populateAnalyticsFilters();
        // Ensure Leaflet map resizes correctly when becoming visible
        if (typeof initMap === 'function') initMap(true);
        if (typeof loadMapForCountry === 'function' && typeof geoJsonData !== 'undefined' && !geoJsonData) {
            const country = document.querySelector('input[name="countryToggle"]:checked')?.value || 'mx';
            loadMapForCountry(country);
        }
        setTimeout(() => {
            if (typeof window.invalidateMapSize === 'function') {
                window.invalidateMapSize();
            } else if (typeof map !== 'undefined' && map !== null) {
                map.invalidateSize();
            }
            if (typeof renderChoropleth === 'function') {
                renderChoropleth();
            }
        }, 120);
    }
}

async function initCountrySelector() {
    const container = document.getElementById('countrySegmentedControl');
    if (!container) return;

    try {
        const res = await fetch('/api/available-maps');
        const maps = await res.json();
        
        container.innerHTML = maps.map((m, idx) => `
            <label class="flex-1 text-center cursor-pointer relative">
                <input type="radio" name="countryToggle" value="${m.key}" class="peer sr-only" ${m.key === 'mx' || idx === 0 ? 'checked' : ''}>
                <div class="py-1 px-2 text-sm rounded-md peer-checked:bg-white peer-checked:text-primary peer-checked:shadow-sm text-on-surface-variant font-medium transition-all">
                    ${m.country_name}
                </div>
            </label>
        `).join('');

        // Automatically load GeoJSON map for default selected country
        const defaultCountry = document.querySelector('input[name="countryToggle"]:checked')?.value || 'mx';
        if (typeof loadMapForCountry === 'function') {
            loadMapForCountry(defaultCountry);
        }

        // Remove error pulse and update map when country changes
        container.addEventListener('change', (e) => {
            container.classList.remove('border-red-500', 'ring-2', 'ring-red-500', 'animate-shake');
            if (e.target && e.target.name === 'countryToggle' && typeof loadMapForCountry === 'function') {
                loadMapForCountry(e.target.value);
            }
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
    renderTopStories();
    renderFullFeed();
    switchTab('main');

    // Initialize Leaflet map immediately so tiles load before any fetch
    if (typeof initMap === 'function') initMap();
});
// ============================================
// PAGINATION & SORTING HELPERS
// ============================================
function renderPaginationControls(buttonsContainerId, infoContainerId, totalItems, currentPage, pageSize, setPageFnName) {
    const infoEl = document.getElementById(infoContainerId);
    const buttonsEl = document.getElementById(buttonsContainerId);
    if (!infoEl || !buttonsEl) return;
    
    const totalPages = Math.ceil(totalItems / pageSize) || 1;
    const startIndex = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
    const endIndex = Math.min(currentPage * pageSize, totalItems);
    
    infoEl.textContent = `Showing ${startIndex}-${endIndex} of ${totalItems} entries`;
    
    let html = '';
    
    // Previous Button
    if (currentPage <= 1) {
        html += `<button disabled class="px-2.5 py-1 rounded border border-outline-variant/30 text-on-surface-variant/40 cursor-not-allowed text-xs font-medium">Prev</button>`;
    } else {
        html += `<button onclick="${setPageFnName}(${currentPage - 1})" class="px-2.5 py-1 rounded border border-outline-variant/30 hover:bg-surface-container-high transition-colors text-on-surface text-xs font-medium">Prev</button>`;
    }
    
    // Page Number Buttons
    let pages = [];
    if (totalPages <= 5) {
        for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
        pages.push(1);
        if (currentPage > 3) pages.push('...');
        const start = Math.max(2, currentPage - 1);
        const end = Math.min(totalPages - 1, currentPage + 1);
        for (let i = start; i <= end; i++) {
            if (!pages.includes(i)) pages.push(i);
        }
        if (currentPage < totalPages - 2) pages.push('...');
        if (!pages.includes(totalPages)) pages.push(totalPages);
    }
    
    pages.forEach(p => {
        if (p === '...') {
            html += `<span class="px-2 py-1 text-xs text-on-surface-variant opacity-60">...</span>`;
        } else if (p === currentPage) {
            html += `<button class="px-2.5 py-1 rounded bg-primary text-on-primary font-bold text-xs shadow-sm">${p}</button>`;
        } else {
            html += `<button onclick="${setPageFnName}(${p})" class="px-2.5 py-1 rounded border border-outline-variant/30 hover:bg-surface-container-high transition-colors text-on-surface text-xs font-medium">${p}</button>`;
        }
    });
    
    // Next Button
    if (currentPage >= totalPages) {
        html += `<button disabled class="px-2.5 py-1 rounded border border-outline-variant/30 text-on-surface-variant/40 cursor-not-allowed text-xs font-medium">Next</button>`;
    } else {
        html += `<button onclick="${setPageFnName}(${currentPage + 1})" class="px-2.5 py-1 rounded border border-outline-variant/30 hover:bg-surface-container-high transition-colors text-on-surface text-xs font-medium">Next</button>`;
    }
    
    buttonsEl.innerHTML = html;
}

// ============================================
// HISTORY VIEWER
// ============================================
let historyData = [];
let historySearchQuery = '';
let historyStatusFilter = 'ALL';
let historyHideZero = false;
let historySortColumn = 'scraped_at';
let historySortDir = 'desc';
let historyPage = 1;
let historyPageSize = 10;
let selectedHistoryRuns = new Set();
let multiRunMode = false;

window.toggleAllHistorySelection = function() {
    const master = document.getElementById('historyMasterCheckbox');
    const checked = master.checked;
    const cbs = document.querySelectorAll('.history-row-checkbox:not(:disabled)');
    cbs.forEach(cb => {
        cb.checked = checked;
        if(checked) selectedHistoryRuns.add(cb.value);
        else selectedHistoryRuns.delete(cb.value);
    });
    updateHistorySelectionUI();
};

window.updateHistorySelection = function() {
    const cbs = document.querySelectorAll('.history-row-checkbox');
    let allChecked = true;
    let anyValid = false;
    cbs.forEach(cb => {
        if(!cb.disabled) {
            anyValid = true;
            if(cb.checked) selectedHistoryRuns.add(cb.value);
            else {
                selectedHistoryRuns.delete(cb.value);
                allChecked = false;
            }
        }
    });
    const master = document.getElementById('historyMasterCheckbox');
    if(master) master.checked = anyValid && allChecked;
    updateHistorySelectionUI();
};

function updateHistorySelectionUI() {
    const btn = document.getElementById('mapSelectedBtn');
    const countSpan = document.getElementById('mapSelectedCount');
    if(!btn || !countSpan) return;
    
    // Ensure checkboxes reflect Set state (for pagination)
    const cbs = document.querySelectorAll('.history-row-checkbox');
    cbs.forEach(cb => {
        if(selectedHistoryRuns.has(cb.value)) cb.checked = true;
    });

    if(selectedHistoryRuns.size >= 2) {
        countSpan.textContent = `Map Selected (${selectedHistoryRuns.size}) \u2192`;
        btn.classList.remove('hidden');
    } else {
        btn.classList.add('hidden');
    }
}

window.mapSelectedHistory = async function() {
    if(selectedHistoryRuns.size < 2) return;
    const ids = Array.from(selectedHistoryRuns);
    
    updateStatus(`Aggregating ${ids.length} executions...`);
    try {
        const response = await fetch('/api/analytics/aggregate', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ execution_ids: ids })
        });
        
        if (!response.ok) throw new Error('Aggregate load failed');
        const data = await response.json();
        
        multiRunMode = true;
        
        // --- Full Teardown ---
        totalArticles = 0;
        uniqueStates = new Set();
        stateFrequency = {};
        sourceFrequency = {};
        if(typeof analyticsSelectedStates !== 'undefined') analyticsSelectedStates.clear();
        if(typeof analyticsSelectedSources !== 'undefined') analyticsSelectedSources.clear();
        if(typeof feedSelectedStates !== 'undefined') feedSelectedStates.clear();
        if(typeof feedSelectedSources !== 'undefined') feedSelectedSources.clear();
        currentFilter = null;
        if(typeof updateAnalyticsTriggerLabel === 'function') {
            ['State', 'Source'].forEach(type => updateAnalyticsTriggerLabel(type));
        }
        const analyticsDate = document.getElementById('analyticsDateFilter');
        if (analyticsDate) {
            if (analyticsDate._flatpickr) analyticsDate._flatpickr.clear();
            analyticsDate.value = '';
        }
        const resetBtn = document.getElementById('analyticsResetBtn');
        if (resetBtn) resetBtn.classList.add('hidden');
        if (typeof resetAnalytics === 'function') resetAnalytics();
        if (typeof resetMapState === 'function') resetMapState();

        // Setup Active Runs chips
        const activeRunsContainer = document.getElementById('activeRunsContainer');
        if(activeRunsContainer) {
            activeRunsContainer.innerHTML = '';
            
            // Limit to 3 explicit chips + "and X more" if many
            const limit = 3;
            const shown = data.executions.slice(0, limit);
            const extra = data.executions.length - limit;
            
            shown.forEach(exec => {
                const term = exec.search_term || exec.execution_id.substring(0,8);
                let f = {};
                try { f = typeof exec.filters === 'string' ? JSON.parse(exec.filters) : (exec.filters || {}); } catch(e){}
                const qrange = f.qrangedate || 'All time';
                const scrapedStr = new Date(exec.scraped_at).toLocaleString();
                
                activeRunsContainer.innerHTML += `
                    <div class="flex items-center gap-1 bg-primary/10 text-primary px-2 py-1 rounded-full text-xs font-medium border border-primary/20">
                        <span class="truncate max-w-[150px]" title="Query: ${exec.search_term}\nSearch Dates: ${qrange}\nScraped: ${scrapedStr}">${term}</span>
                        <button onclick="removeAggregatedRun('${exec.execution_id}')" class="hover:bg-primary/20 rounded-full w-4 h-4 flex items-center justify-center transition-colors">
                            <span class="material-symbols-outlined text-[12px]">close</span>
                        </button>
                    </div>
                `;
            });
            
            if(extra > 0) {
                activeRunsContainer.innerHTML += `
                    <div class="text-xs text-on-surface-variant font-medium px-1">
                        +${extra} more
                    </div>
                `;
            }
            
            activeRunsContainer.innerHTML += `
                <button onclick="clearAllAggregatedRuns()" class="text-xs text-on-surface-variant hover:text-red-500 underline decoration-dotted ml-1 transition-colors">
                    Clear All
                </button>
            `;
        }
        
        // Hide global search bar text since we are in multi-run
        const mInput = document.getElementById('mainSearchInput');
        if(mInput) mInput.value = '';
        
        // --- Full Hydration ---
        const rawArticles = data.articles || [];
        collectedArticles = rawArticles.map(a => {
            let gd = [];
            try {
                if(typeof a.geodata === 'string' && a.geodata !== "null") gd = JSON.parse(a.geodata);
                else if(Array.isArray(a.geodata)) gd = a.geodata;
                else if(a.states && a.states !== "null") {
                    gd = typeof a.states === 'string' ? JSON.parse(a.states) : a.states;
                }
            } catch(e){}
            
            let fdate = a.date || '';
            if (fdate && fdate.length > 10) fdate = fdate.substring(0,10);
            return {
                title: a.title,
                url: a.url,
                date: fdate,
                source: a.source,
                states: Array.isArray(gd) ? gd : [],
                origin_search_term: a.origin_search_term,
                image: a.image_url || a.image || null,
                image_url: a.image_url || a.image || null
            };
        });

        extractedStatesGlobal = [];
        let hasGeodata = false;

        collectedArticles.forEach(a => {
            if (typeof updateKPIs === 'function') updateKPIs(a);
            if (typeof updateMap === 'function') updateMap(a.states);
            if (typeof updateSourcesBar === 'function') updateSourcesBar(a.source);
            if (typeof updateStatesBar === 'function') updateStatesBar(a.states);
            if (typeof updateTimeline === 'function') updateTimeline(a.date);
            
            if (a.states && Array.isArray(a.states) && a.states.length > 0) {
                extractedStatesGlobal.push(...a.states);
                hasGeodata = true;
            }
        });

        const exportBtn = document.getElementById('exportExcelBtn');
        if (exportBtn) exportBtn.classList.remove('hidden');
        const mapearBtn = document.getElementById('mapearBtn');
        if (mapearBtn) mapearBtn.classList.remove('hidden');

        if(typeof renderTopStories === 'function') renderTopStories();
        if(typeof renderFullFeed === 'function') renderFullFeed();
        if(typeof populateAnalyticsFilters === 'function') populateAnalyticsFilters();
        
        if (hasGeodata) {
            setTimeout(() => {
                if (typeof window.invalidateMapSize === 'function') {
                    window.invalidateMapSize();
                } else if (typeof map !== 'undefined' && map) {
                    map.invalidateSize();
                }
                if (typeof renderChoropleth === 'function') {
                    renderChoropleth();
                }
            }, 120);
        }
        
        if(typeof switchTab === 'function') switchTab('analytics');
        updateStatus(`Aggregated ${collectedArticles.length} unique articles across ${data.executions.length} runs (complete).`);
    } catch(e) {
        console.error(e);
        updateStatus('Error aggregating executions', true);
    }
};

window.removeAggregatedRun = function(id) {
    selectedHistoryRuns.delete(id);
    if(selectedHistoryRuns.size >= 2) {
        mapSelectedHistory(); // Re-fetch without this run
    } else {
        clearAllAggregatedRuns();
    }
};

window.clearAllAggregatedRuns = function() {
    selectedHistoryRuns.clear();
    multiRunMode = false;
    const activeRunsContainer = document.getElementById('activeRunsContainer');
    if(activeRunsContainer) activeRunsContainer.innerHTML = '';
    
    // Clear data
    totalArticles = 0;
    uniqueStates = new Set();
    stateFrequency = {};
    sourceFrequency = {};
    collectedArticles = [];
    extractedStatesGlobal = [];
    currentFilter = null;
    if (typeof resetAnalytics === 'function') resetAnalytics();
    if (typeof resetMapState === 'function') resetMapState();
    
    updateHistorySelectionUI();
    switchTab('view-history');
};

async function loadHistory() {
    try {
        const response = await fetch('/api/history');
        if (!response.ok) throw new Error('Failed to fetch history');
        historyData = await response.json();
        renderHistoryTable();
    } catch (e) {
        console.error(e);
        const tbody = document.getElementById('historyTableBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-error">Failed to load history</td></tr>';
    }
}

function onHistoryFilterChange() {
    const searchInput = document.getElementById('historySearchInput');
    historySearchQuery = (searchInput ? searchInput.value : '').trim().toLowerCase();
    
    const statusSelect = document.getElementById('historyStatusFilter');
    historyStatusFilter = statusSelect ? statusSelect.value : 'ALL';
    
    const hideZeroCheck = document.getElementById('historyHideZeroCheck');
    historyHideZero = hideZeroCheck ? hideZeroCheck.checked : false;
    
    historyPage = 1;
    renderHistoryTable();
}

function onHistoryPageSizeChange(newSize) {
    historyPageSize = parseInt(newSize, 10) || 10;
    historyPage = 1;
    renderHistoryTable();
}

function toggleHistorySort(column) {
    if (historySortColumn !== column) {
        historySortColumn = column;
        historySortDir = 'desc';
    } else {
        if (historySortDir === 'desc') {
            historySortDir = 'asc';
        } else if (historySortDir === 'asc') {
            historySortColumn = 'scraped_at';
            historySortDir = 'desc';
        } else {
            historySortDir = 'desc';
        }
    }
    historyPage = 1;
    renderHistoryTable();
}

function setHistoryPage(page) {
    historyPage = page;
    renderHistoryTable();
}

function updateHistorySortIcons() {
    const cols = ['search_term', 'scraped_at', 'total_articles'];
    cols.forEach(col => {
        const iconEl = document.getElementById(`sort-icon-history-${col}`);
        if (!iconEl) return;
        if (historySortColumn === col) {
            iconEl.className = 'material-symbols-outlined text-[16px] text-primary';
            iconEl.textContent = historySortDir === 'asc' ? 'arrow_upward' : 'arrow_downward';
        } else {
            iconEl.className = 'material-symbols-outlined text-[16px] opacity-40';
            iconEl.textContent = 'unfold_more';
        }
    });
}

function renderHistoryTable() {
    const tbody = document.getElementById('historyTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    updateHistorySortIcons();
    
    let filtered = historyData.filter(h => {
        if (historySearchQuery) {
            const matchesSearch = (h.search_term || '').toLowerCase().includes(historySearchQuery) ||
                JSON.stringify(h.filters || {}).toLowerCase().includes(historySearchQuery);
            if (!matchesSearch) return false;
        }
        if (historyStatusFilter === 'ANALYZED' && h.status !== 'COMPLETED') return false;
        if (historyStatusFilter === 'RAW' && h.status === 'COMPLETED') return false;
        if (historyHideZero && (parseInt(h.total_articles, 10) || 0) <= 0) return false;
        
        return true;
    });
    
    filtered.sort((a, b) => {
        let valA, valB;
        if (historySortColumn === 'search_term') {
            valA = (a.search_term || '').toLowerCase();
            valB = (b.search_term || '').toLowerCase();
            if (valA < valB) return historySortDir === 'asc' ? -1 : 1;
            if (valA > valB) return historySortDir === 'asc' ? 1 : -1;
            return 0;
        } else if (historySortColumn === 'total_articles') {
            valA = parseInt(a.total_articles, 10) || 0;
            valB = parseInt(b.total_articles, 10) || 0;
            return historySortDir === 'asc' ? valA - valB : valB - valA;
        } else {
            valA = new Date(a.scraped_at || a.timestamp || 0).getTime();
            valB = new Date(b.scraped_at || b.timestamp || 0).getTime();
            return historySortDir === 'asc' ? valA - valB : valB - valA;
        }
    });
    
    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / historyPageSize) || 1;
    if (historyPage > totalPages) historyPage = totalPages;
    if (historyPage < 1) historyPage = 1;
    
    const startIndex = (historyPage - 1) * historyPageSize;
    const endIndex = Math.min(startIndex + historyPageSize, totalItems);
    const paginated = filtered.slice(startIndex, endIndex);
    
    if (totalItems === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-on-surface-variant">No history records found</td></tr>';
        renderPaginationControls('historyPaginationButtons', 'historyPageInfo', 0, 1, historyPageSize, 'setHistoryPage');
        return;
    }
    
    paginated.forEach(run => {
        const tr = document.createElement('tr');
        tr.className = "border-b border-outline-variant/10 hover:bg-surface-container-low transition-colors";
        
        let filtersStr = '';
        try {
            const f = typeof run.filters === 'string' ? JSON.parse(run.filters) : run.filters;
            if(f) {
                filtersStr = Object.entries(f).map(([k,v]) => v ? '<span class="inline-block bg-surface-container-high px-2 py-0.5 rounded text-xs mr-1">' + k + ':' + v + '</span>' : '').join('');
            }
        } catch(e) {}
        
        const scrapedOnHtml = formatTemporal(run.scraped_at || run.timestamp);
        
        let statusBadge = '';
        if (run.status === 'COMPLETED') {
            statusBadge = '<span class="px-2 py-0.5 ml-2 bg-green-100 text-green-800 text-[10px] font-bold rounded-full border border-green-200">Analyzed</span>';
        } else if (run.status === 'SCRAPED') {
            statusBadge = '<span class="px-2 py-0.5 ml-2 bg-blue-50 text-blue-800 text-[10px] font-bold rounded-full border border-blue-200">Raw Articles</span>';
        } else if (run.status) {
            statusBadge = `<span class="px-2 py-0.5 ml-2 bg-gray-100 text-gray-800 text-[10px] font-bold rounded-full border border-gray-200">${run.status}</span>`;
        }
        
        const isUnanalyzed = (run.status === 'SCRAPED' || run.status === 'ERROR' || !run.total_articles || run.total_articles == 0);
        
        tr.innerHTML = `
            <td class="py-2 px-3 align-middle text-center">
                <input type="checkbox" class="history-row-checkbox accent-primary w-4 h-4 cursor-pointer" value="${run.execution_id}" ${isUnanalyzed ? 'disabled' : ''} onchange="updateHistorySelection()">
            </td>
            <td class="py-2 px-3 align-middle font-medium flex items-center">${run.search_term || ''}${statusBadge}</td>
            <td class="py-2 px-3 align-middle">${filtersStr}</td>
            <td class="py-2 px-3 align-middle">${scrapedOnHtml}</td>
            <td class="py-2 px-3 align-middle text-center">${run.total_articles || 0}</td>
            <td class="py-2 px-3 align-middle text-right">
                <button onclick="viewExecution('${run.execution_id}')" class="text-primary hover:bg-primary-container/10 p-1.5 rounded mr-1" title="Load / View" ${isUnanalyzed ? 'disabled style="opacity:0.5"' : ''}>
                    <span class="material-symbols-outlined text-[18px]">visibility</span>
                </button>
                <button onclick="exportHistory('${run.execution_id}')" class="text-primary hover:bg-primary-container/10 p-1.5 rounded" title="Export JSON">
                    <span class="material-symbols-outlined text-[18px]">download</span>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
    
    renderPaginationControls('historyPaginationButtons', 'historyPageInfo', totalItems, historyPage, historyPageSize, 'setHistoryPage');
    
    // Apply local storage column visibility
    const stored = localStorage.getItem('historyCols');
    if (stored) {
        const states = JSON.parse(stored);
        states.forEach((visible, i) => {
            const cb = document.querySelector('#historyColumnToggle input:nth-child(' + (i+1) + ')');
            if (cb) cb.checked = visible;
            updateHistoryCols(i + 1, false);
        });
    }
    
    // Restore master checkbox state and update selection UI
    updateHistorySelection();
}

window.onHistoryFilterChange = onHistoryFilterChange;
window.onHistoryPageSizeChange = onHistoryPageSizeChange;
window.toggleHistorySort = toggleHistorySort;
window.setHistoryPage = setHistoryPage;
window.filterHistoryTable = onHistoryFilterChange;

window.toggleHistoryColumns = function() {
    const div = document.getElementById('historyColumnToggle');
    if (div) div.classList.toggle('hidden');
};

window.updateHistoryCols = function(colIdx, save = true) {
    const table = document.getElementById('historyTable');
    if (!table) return;
    
    let isVisible = true;
    const labels = document.querySelectorAll('#historyColumnToggle label input');
    
    // colIdx passed from HTML is now the table cell index (1-based because 0 is checkbox)
    // The labels array is still 0-based
    const labelIdx = colIdx - 1; 

    if (labels && labels[labelIdx]) {
        isVisible = labels[labelIdx].checked;
    }
    
    const trs = table.querySelectorAll('tr');
    trs.forEach(tr => {
        const cells = tr.children;
        if (cells.length > colIdx) {
            cells[colIdx].style.display = isVisible ? '' : 'none';
        }
    });
    
    if (save) {
        const states = Array.from(labels).map(cb => cb.checked);
        localStorage.setItem('historyCols', JSON.stringify(states));
    }
};

window.viewExecution = async function(execution_id) {
    updateStatus('Loading execution ' + execution_id + '...');
    try {
        const response = await fetch('/api/history/' + execution_id);
        if (!response.ok) throw new Error('Execution load failed');
        const data = await response.json();
        
        // Reset multi-run state
        multiRunMode = false;
        selectedHistoryRuns.clear();
        window.currentDiscoveryExecutionId = execution_id;
        const activeRunsContainer = document.getElementById('activeRunsContainer');
        if(activeRunsContainer) activeRunsContainer.innerHTML = '';
        updateHistorySelectionUI();
        
        // Reset local statistics and analytics state
        totalArticles = 0;
        uniqueStates = new Set();
        stateFrequency = {};
        sourceFrequency = {};
        analyticsSelectedStates.clear();
        analyticsSelectedSources.clear();
        feedSelectedStates.clear();
        feedSelectedSources.clear();
        currentFilter = null;
        ['State', 'Source'].forEach(type => updateAnalyticsTriggerLabel(type));
        const analyticsDate = document.getElementById('analyticsDateFilter');
        if (analyticsDate) {
            if (analyticsDate._flatpickr) analyticsDate._flatpickr.clear();
            analyticsDate.value = '';
        }
        const resetBtn = document.getElementById('analyticsResetBtn');
        if (resetBtn) resetBtn.classList.add('hidden');
        if (typeof resetAnalytics === 'function') resetAnalytics();
        if (typeof resetMapState === 'function') resetMapState();

        const rawArticles = data.articles || [];
        collectedArticles = rawArticles.map(a => {
            let states = [];
            try {
                if (a.geodata && a.geodata !== "null") {
                    states = typeof a.geodata === 'string' ? JSON.parse(a.geodata) : a.geodata;
                } else if (a.states && a.states !== "null") {
                    states = typeof a.states === 'string' ? JSON.parse(a.states) : a.states;
                }
            } catch (e) {
                console.warn('Could not parse geodata:', e);
            }
            const remoteImg = a.image_url || a.image || null;
            return {
                ...a,
                image: remoteImg,
                image_url: remoteImg,
                states: Array.isArray(states) ? states : []
            };
        });

        // Ensure GeoJSON map is loaded for the execution's target country
        let country = 'mx';
        try {
            const f = typeof data.execution?.filters === 'string' ? JSON.parse(data.execution.filters) : data.execution?.filters;
            if (f && f.country) country = f.country;
        } catch(e) {}

        // Sync country toggle radio in UI
        const countryRadio = document.querySelector(`input[name="countryToggle"][value="${country}"]`);
        if (countryRadio) countryRadio.checked = true;

        // Auto-switch to analytics tab FIRST if we have geodata, otherwise main.
        // Switching tabs first ensures the container (#view-analytics) is visible
        // with real dimensions when Leaflet initializes and constructs vector paths.
        const hasGeodata = collectedArticles.some(a => a.states && a.states.length > 0);
        if (hasGeodata) {
            switchTab('analytics');
        } else {
            switchTab('main');
        }
        
        if (typeof loadMapForCountry === 'function') {
            await loadMapForCountry(country);
        }

        // Hydrate KPIs, map and charts with historical data
        collectedArticles.forEach(a => {
            if (typeof updateKPIs === 'function') updateKPIs(a);
            if (typeof updateMap === 'function') updateMap(a.states);
            if (typeof updateSourcesBar === 'function') updateSourcesBar(a.source);
            if (typeof updateStatesBar === 'function') updateStatesBar(a.states);
            if (typeof updateTimeline === 'function') updateTimeline(a.date);
        });

        // Unhide action buttons
        const exportBtn = document.getElementById('exportExcelBtn');
        if (exportBtn) exportBtn.classList.remove('hidden');
        const mapearBtn = document.getElementById('mapearBtn');
        if (mapearBtn) mapearBtn.classList.remove('hidden');

        renderTopStories();
        renderFullFeed();

        if (typeof populateAnalyticsFilters === 'function') populateAnalyticsFilters();

        if (hasGeodata) {
            setTimeout(() => {
                if (typeof window.invalidateMapSize === 'function') {
                    window.invalidateMapSize();
                } else if (typeof map !== 'undefined' && map) {
                    map.invalidateSize();
                }
                if (typeof renderChoropleth === 'function') {
                    renderChoropleth();
                }
            }, 120);
        }
        
        updateStatus('Loaded ' + collectedArticles.length + ' articles from history (complete).');
    } catch (e) {
        console.error(e);
        updateStatus('❌ Failed to load execution');
    }
};

window.exportHistory = async function(execution_id) {
    try {
        const response = await fetch('/api/history/' + execution_id);
        if (!response.ok) throw new Error('Export failed');
        const data = await response.json();
        
        const blob = new Blob([JSON.stringify(data.articles, null, 2)], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'execution_' + execution_id + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (e) {
        console.error(e);
        alert('Failed to export history.');
    }
};

// ============================================
// Phase 4: Jobs Queue Rendering & Polling
// ============================================
let jobsPollInterval = null;
let liveJobsTimer = null;
let currentJobsData = [];
let jobsStatusFilter = 'ALL';
let jobsSearchQuery = '';
let jobsSortColumn = 'end_time';
let jobsSortDir = 'desc';
let jobsPage = 1;
let jobsPageSize = 10;

function onJobsFilterChange() {
    const searchInput = document.getElementById('jobsSearchInput');
    jobsSearchQuery = (searchInput ? searchInput.value : '').trim().toLowerCase();
    
    const statusSelect = document.getElementById('jobsStatusFilter');
    jobsStatusFilter = statusSelect ? statusSelect.value : 'ALL';
    jobsPage = 1;
    renderJobsQueue(currentJobsData);
}

function onJobsPageSizeChange(newSize) {
    jobsPageSize = parseInt(newSize, 10) || 10;
    jobsPage = 1;
    renderJobsQueue(currentJobsData);
}

function toggleJobsSort(column) {
    if (jobsSortColumn !== column) {
        jobsSortColumn = column;
        jobsSortDir = 'desc';
    } else {
        if (jobsSortDir === 'desc') {
            jobsSortDir = 'asc';
        } else if (jobsSortDir === 'asc') {
            jobsSortColumn = 'end_time';
            jobsSortDir = 'desc';
        } else {
            jobsSortDir = 'desc';
        }
    }
    jobsPage = 1;
    renderJobsQueue(currentJobsData);
}

function setJobsPage(page) {
    jobsPage = page;
    renderJobsQueue(currentJobsData);
}

function updateJobsSortIcons() {
    const cols = ['query', 'status', 'end_time', 'elapsed'];
    cols.forEach(col => {
        const iconEl = document.getElementById(`sort-icon-jobs-${col}`);
        if (!iconEl) return;
        if (jobsSortColumn === col) {
            iconEl.className = 'material-symbols-outlined text-[16px] text-primary';
            iconEl.textContent = jobsSortDir === 'asc' ? 'arrow_upward' : 'arrow_downward';
        } else {
            iconEl.className = 'material-symbols-outlined text-[16px] opacity-40';
            iconEl.textContent = 'unfold_more';
        }
    });
}

function startLiveJobsTimer() {
    if (!liveJobsTimer) {
        liveJobsTimer = setInterval(() => {
            currentJobsData.forEach(job => {
                if (['STARTED', 'STARTING', 'QUEUED', 'SCRAPING', 'ANALYZING', 'QUEUED_FOR_ANALYSIS'].includes(job.status)) {
                    const elapsedCell = document.getElementById(`elapsed-${job.run_id}`);
                    if (elapsedCell && job.start_time) {
                        const start = new Date(job.start_time).getTime();
                        const diffSec = Math.max(0, Math.floor((Date.now() - start) / 1000));
                        const m = Math.floor(diffSec / 60).toString().padStart(2, '0');
                        const s = (diffSec % 60).toString().padStart(2, '0');
                        elapsedCell.textContent = `${m}:${s}`;
                    }
                }
            });
        }, 1000);
    }
}

function stopLiveJobsTimer() {
    if (liveJobsTimer) {
        clearInterval(liveJobsTimer);
        liveJobsTimer = null;
    }
}

function renderJobsQueue(jobs) {
    const tbody = document.getElementById('jobsTableBody');
    if (!tbody) return;
    
    currentJobsData = jobs || [];
    updateJobsSortIcons();
    
    // 1. Filter
    let filtered = currentJobsData.filter(j => {
        if (jobsSearchQuery) {
            const queryMatch = (j.query || '').toLowerCase().includes(jobsSearchQuery);
            const runIdMatch = (j.run_id || '').toLowerCase().includes(jobsSearchQuery);
            if (!queryMatch && !runIdMatch) return false;
        }
        if (jobsStatusFilter === 'ACTIVE') {
            return ['QUEUED_FOR_ANALYSIS', 'ANALYZING', 'SCRAPING', 'STARTED', 'STARTING'].includes(j.status);
        } else if (jobsStatusFilter === 'READY') {
            return ['SCRAPED', 'PARTIALLY_ANALYZED'].includes(j.status);
        } else if (jobsStatusFilter === 'COMPLETED') {
            return ['COMPLETED', 'SUCCESS'].includes(j.status);
        }
        return true;
    });
    
    // 2. Sort
    filtered.sort((a, b) => {
        let valA, valB;
        if (jobsSortColumn === 'query') {
            valA = (a.query || '').toLowerCase();
            valB = (b.query || '').toLowerCase();
            if (valA < valB) return jobsSortDir === 'asc' ? -1 : 1;
            if (valA > valB) return jobsSortDir === 'asc' ? 1 : -1;
            return 0;
        } else if (jobsSortColumn === 'status') {
            valA = (a.status || '').toLowerCase();
            valB = (b.status || '').toLowerCase();
            if (valA < valB) return jobsSortDir === 'asc' ? -1 : 1;
            if (valA > valB) return jobsSortDir === 'asc' ? 1 : -1;
            return 0;
        } else if (jobsSortColumn === 'elapsed') {
            const getDuration = (j) => {
                if (!j.start_time) return 0;
                let end = Date.now();
                const startDate = new Date(j.start_time).getTime();
                if (j.end_time) end = new Date(j.end_time).getTime();
                else if (!['STARTED', 'STARTING', 'SCRAPING', 'QUEUED_FOR_ANALYSIS', 'ANALYZING'].includes(j.status)) end = startDate;
                return Math.max(0, Math.floor((end - startDate) / 1000));
            };
            valA = getDuration(a);
            valB = getDuration(b);
            return jobsSortDir === 'asc' ? valA - valB : valB - valA;
        } else {
            valA = new Date(a.end_time || a.start_time || 0).getTime();
            valB = new Date(b.end_time || b.start_time || 0).getTime();
            return jobsSortDir === 'asc' ? valA - valB : valB - valA;
        }
    });
    
    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / jobsPageSize) || 1;
    if (jobsPage > totalPages) jobsPage = totalPages;
    if (jobsPage < 1) jobsPage = 1;
    
    const startIndex = (jobsPage - 1) * jobsPageSize;
    const endIndex = Math.min(startIndex + jobsPageSize, totalItems);
    const paginated = filtered.slice(startIndex, endIndex);

    if (totalItems === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="py-4 text-center text-on-surface-variant">No jobs found matching criteria.</td></tr>';
        renderPaginationControls('jobsPaginationButtons', 'jobsPageInfo', 0, 1, jobsPageSize, 'setJobsPage');
        stopLiveJobsTimer();
        return;
    }

    const existingRows = Array.from(tbody.querySelectorAll('tr[data-run-id]')).map(tr => tr.getAttribute('data-run-id'));
    const paginatedIds = paginated.map(j => j.run_id);
    
    existingRows.forEach(id => {
        if (!paginatedIds.includes(id)) {
            const tr = document.getElementById(`job-row-${id}`);
            if (tr) tr.remove();
        }
    });

    if (tbody.querySelector('td[colspan="5"]') || tbody.querySelector('td[colspan="6"]')) {
        tbody.innerHTML = '';
    }

    paginated.forEach((job, index) => {
        const isRunning = job.status === 'ANALYZING' || job.status === 'STARTED' || job.status === 'SCRAPING';
        const isQueued = job.status === 'QUEUED_FOR_ANALYSIS';
        
        let elapsedStr = "-";
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
        
        const lastUpdatedHtml = formatTemporal(job.end_time || job.start_time);
        
        let statusHtml = '';
        if (isRunning) {
            statusHtml = `
                <div class="flex flex-col gap-1 w-[200px]">
                    <div class="flex items-center gap-2">
                        <span class="material-symbols-outlined animate-spin text-primary text-[16px]">sync</span>
                        <span class="text-label-sm font-medium text-on-surface">${job.current_step || 'Starting...'}</span>
                    </div>
                    <div class="w-full bg-surface-variant rounded-full h-1.5 overflow-hidden">
                        <div class="bg-primary h-1.5 rounded-full transition-all duration-300" style="width: ${job.progress_pct || 0}%"></div>
                    </div>
                </div>`;
        } else {
            let badgeClass = "bg-surface-container text-on-surface";
            let displayStatus = job.status;
            if (job.status === 'COMPLETED' || job.status === 'SUCCESS') badgeClass = "bg-green-100 text-green-800";
            else if (job.status === 'SCRAPED') badgeClass = "bg-blue-50 text-blue-800";
            else if (job.status === 'QUEUED_FOR_ANALYSIS') {
                badgeClass = "bg-purple-100 text-purple-800";
                const qPos = filtered.slice(0, startIndex + index + 1).filter(j => j.status === 'QUEUED_FOR_ANALYSIS').length;
                displayStatus = `QUEUED (Pos: ${qPos})`;
            }
            else if (job.status === 'PARTIALLY_ANALYZED') badgeClass = "bg-orange-100 text-orange-800";
            else if (job.status === 'PAUSED_BLOCKED') badgeClass = "bg-yellow-100 text-yellow-800";
            else if (job.status === 'FAILURE' || job.status === 'CANCELLED' || job.status === 'ERROR') badgeClass = "bg-red-100 text-red-800";
            
            statusHtml = `<span class="px-2 py-1 rounded-full text-[12px] font-medium ${badgeClass}">${displayStatus}</span>`;
        }

        let actionsHtml = `<span class="text-on-surface-variant text-sm">None</span>`;
        if (job.status === 'SCRAPED' || job.status === 'PARTIALLY_ANALYZED') {
            const btnText = job.status === 'PARTIALLY_ANALYZED' ? 'Retry LLM Analysis' : 'Analyze with LLM';
            actionsHtml = `<button onclick="analyzeJob('${job.run_id}')" class="px-3 py-1 bg-primary text-on-primary hover:bg-primary/90 rounded-md text-label-sm font-medium transition-colors">${btnText}</button>`;
        } else if (job.status === 'PAUSED_BLOCKED') {
            actionsHtml = `<button onclick="resumeScrapingJob('${job.run_id}')" class="px-3 py-1 bg-yellow-500 text-white hover:bg-yellow-600 rounded-md text-label-sm font-medium transition-colors">Resume Scraping</button>`;
        } else if (isQueued || isRunning || job.status === 'STARTING') {
            actionsHtml = `<button onclick="cancelJob('${job.run_id}')" class="px-3 py-1 bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 rounded-md text-label-sm font-medium transition-colors">Stop Job</button>`;
        }

        let tr = document.getElementById(`job-row-${job.run_id}`);
        if (!tr) {
            tr = document.createElement('tr');
            tr.id = `job-row-${job.run_id}`;
            tr.setAttribute('data-run-id', job.run_id);
            tr.className = "border-b border-outline-variant/30 hover:bg-surface-container-low transition-colors";
        }
        
        tr.innerHTML = `
            <td class="py-3 px-4 font-mono text-sm">${job.run_id.substring(0,8)}...</td>
            <td class="py-3 px-4 max-w-[200px] truncate" title="${job.query}">${job.query || '(No query)'}</td>
            <td class="py-3 px-4">${statusHtml}</td>
            <td class="py-3 px-4 font-mono text-sm text-on-surface-variant">${lastUpdatedHtml}</td>
            <td class="py-3 px-4 text-on-surface-variant font-mono text-sm" id="elapsed-${job.run_id}">${elapsedStr}</td>
            <td class="py-3 px-4">${actionsHtml}</td>
        `;
        
        // Append to tbody in sorted order
        tbody.appendChild(tr);
    });

    renderPaginationControls('jobsPaginationButtons', 'jobsPageInfo', totalItems, jobsPage, jobsPageSize, 'setJobsPage');

    const hasActiveJobs = currentJobsData.some(j => ['STARTED', 'STARTING', 'QUEUED_FOR_ANALYSIS', 'ANALYZING', 'SCRAPED', 'PAUSED_BLOCKED'].includes(j.status));
    const jobsTabActive = !document.getElementById('view-jobs').classList.contains('hidden');
    
    if (hasActiveJobs) {
        startLiveJobsTimer();
        if (jobsTabActive && !jobsPollInterval) {
            jobsPollInterval = setInterval(() => {
                if (!document.getElementById('view-jobs').classList.contains('hidden')) {
                    fetchJobs();
                } else {
                    clearInterval(jobsPollInterval);
                    jobsPollInterval = null;
                }
            }, 1500);
        }
    } else {
        stopLiveJobsTimer();
        if (jobsPollInterval) {
            clearInterval(jobsPollInterval);
            jobsPollInterval = null;
        }
    }
}

window.onJobsFilterChange = onJobsFilterChange;
window.onJobsPageSizeChange = onJobsPageSizeChange;
window.toggleJobsSort = toggleJobsSort;
window.setJobsPage = setJobsPage;

async function resumeScrapingJob(runId) {
    try {
        const response = await fetch(`/api/jobs/${runId}/resume_scraping`, { method: 'POST' });
        const data = await response.json();
        if (data.success) {
            fetchJobs();
        } else {
            alert(`Error resuming job: ${data.error}`);
        }
    } catch (err) {
        console.error("Error resuming scraping job:", err);
    }
}

async function analyzeJob(executionId) {
    try {
        const res = await fetch(`/api/jobs/${executionId}/analyze`, { method: 'POST' });
        if (res.ok) {
            fetchJobs();
        }
    } catch (e) {
        console.error(e);
    }
}
