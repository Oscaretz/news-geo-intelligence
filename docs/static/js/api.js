// static/js/api.js — Handles fetch, EventSource, and file downloads

function buildQueryString() {
    const query = document.getElementById('mainSearchInput')?.value ?? '';
    const qoption = document.getElementById('secondaryInput')?.value ?? '';
    const qexception = document.getElementById('excludeInput')?.value ?? '';
    const qsite = document.getElementById('domainInput')?.value ?? '';
    const qrangedate = document.getElementById('dateRange')?.value ?? '';
    const nqueries = document.getElementById('nqueriesInput')?.value ?? '';
    const country = (document.querySelector('input[name="countryToggle"]:checked')?.value || 'mx').trim();

    return `?query=${encodeURIComponent(query.trim())}` +
           `&qoption=${encodeURIComponent(qoption.trim())}` +
           `&qexception=${encodeURIComponent(qexception.trim())}` +
           `&qsite=${encodeURIComponent(qsite.trim())}` +
           `&qrangedate=${encodeURIComponent(qrangedate.trim())}` +
           `&nqueries=${encodeURIComponent(nqueries.trim())}` +
           `&country=${encodeURIComponent(country)}`;
}

// ============================================
// Stage 1: Discovery (REST)
// ============================================

async function fetchDiscovery() {
    const mainInput = document.getElementById('mainSearchInput');
    const nqueriesInput = document.getElementById('nqueriesInput');
    const warningEl = document.getElementById('search-warning');
    const searchBarWrapper = document.getElementById('searchBarWrapper') || mainInput?.parentElement;
    const countryControl = document.getElementById('countrySegmentedControl');
    const countryChecked = document.querySelector('input[name="countryToggle"]:checked');

    const query = (mainInput?.value || '').trim();
    const nqueriesRaw = (nqueriesInput?.value || '').trim();
    const nqueriesVal = parseInt(nqueriesRaw, 10);
    const hasValidQuantity = nqueriesRaw !== '' && !isNaN(nqueriesVal) && nqueriesVal > 0;

    let hasError = false;

    if (!query) {
        hasError = true;
        if (searchBarWrapper) {
            searchBarWrapper.classList.remove('animate-shake');
            void searchBarWrapper.offsetWidth; // trigger reflow
            searchBarWrapper.classList.add('border-red-500', 'ring-2', 'ring-red-500', 'animate-shake');
        }
    }

    if (!hasValidQuantity) {
        hasError = true;
        if (nqueriesInput) {
            nqueriesInput.classList.remove('animate-shake');
            void nqueriesInput.offsetWidth;
            nqueriesInput.classList.add('border-red-500', 'ring-2', 'ring-red-500', 'animate-shake');
        }
    }

    if (!countryChecked) {
        hasError = true;
        if (countryControl) {
            countryControl.classList.remove('animate-shake');
            void countryControl.offsetWidth;
            countryControl.classList.add('border-red-500', 'ring-2', 'ring-red-500', 'animate-shake');
        }
    }

    if (!hasValidQuantity || !countryChecked) {
        const filterDropdown = document.getElementById('filterDropdown');
        if (filterDropdown && filterDropdown.classList.contains('hidden')) {
            filterDropdown.classList.remove('hidden');
        }
    }

    if (hasError) {
        if (warningEl) warningEl.classList.remove('hidden');
        return;
    }

    if (warningEl) warningEl.classList.add('hidden');
    if (searchBarWrapper) searchBarWrapper.classList.remove('border-red-500', 'ring-2', 'ring-red-500', 'animate-shake');
    if (nqueriesInput) nqueriesInput.classList.remove('border-red-500', 'ring-2', 'ring-red-500', 'animate-shake');

    const filterDropdown = document.getElementById('filterDropdown');
    if (filterDropdown) filterDropdown.classList.add('hidden');

    resetUI('discovery');
    const qs = buildQueryString();
    
    // Bloqueo de concurrencia para evitar peticiones duplicadas
    if (window._isFetching) return;
    window._isFetching = true;

    try {
        const response = await fetch(`/api/discovery${qs}`);
        if (!response.ok) {
            let errMsg = 'Error de servidor';
            try {
                const errData = await response.json();
                if (errData.error) errMsg = errData.error;
            } catch(e) {}
            throw new Error(`Status ${response.status}: ${errMsg}`);
        }
        const data = await response.json();
        const articles = data.articles || data;
        if (data.execution_id) {
            window.currentDiscoveryExecutionId = data.execution_id;
        }

        const selectedCountry = countryChecked?.value || 'mx';
        if (typeof loadMapForCountry === 'function') {
            await loadMapForCountry(selectedCountry);
        }

        const successMsg = typeof i18n !== 'undefined' ? i18n.t('articlesCollectedSuccess', 'Articles successfully collected.') : 'Articles successfully collected.';
        updateStatus(successMsg);

        if (articles.length === 0) {
            renderTopStories([], "No articles found matching your criteria.");
            renderFullFeed();
        } else {
            articles.forEach(article => {
                // Idempotencia: Evitar procesar el artículo en gráficas y KPIs si ya fue ingresado
                if (collectedArticles.some(a => a.url === article.url)) return;
                
                // Proveer arreglo vacío para compatibilidad de KPIs
                article.states = [];

                renderArticle(article, 'discovery'); // ui.js guarda el artículo en crudo aquí
                updateKPIs(article);
                updateSourcesBar(article.source);
                updateStatesBar(article.states); // NUEVO: Alimentar gráfica de Estados
                updateTimeline(article.date);
            });
        }

        document.getElementById('actionButtons').style.display = 'flex';
        const exportBtn = document.getElementById('exportExcelBtn');
        if (exportBtn) exportBtn.classList.remove('hidden');
        const mapearBtn = document.getElementById('mapearBtn');
        if (mapearBtn) mapearBtn.classList.remove('hidden');
    } catch (error) {
        console.error("Detalle del error:", error);
        const connErr = typeof i18n !== 'undefined' ? i18n.t('connectionError', 'Connection error') : 'Connection error';
        updateStatus(`❌ ${connErr}`);
    } finally {
        window._isFetching = false;
    }
}

// ============================================
// Stage 2: Mapping (EventSource)
// ============================================

async function startStreamMapping() {
    resetUI('mapping');
    
    const countryChecked = document.querySelector('input[name="countryToggle"]:checked');
    const selectedCountry = countryChecked?.value || 'mx';
    if (typeof loadMapForCountry === 'function') {
        await loadMapForCountry(selectedCountry);
    }
    
    // Si estamos en modo multi-run (historial múltiple)
    if (typeof multiRunMode !== 'undefined' && multiRunMode && typeof selectedHistoryRuns !== 'undefined' && selectedHistoryRuns.size > 0) {
        const sendMsg = typeof i18n !== 'undefined' ? i18n.t('sendingJobsToAnalysis', 'Sending {count} jobs to analysis...').replace('{count}', selectedHistoryRuns.size) : `Sending ${selectedHistoryRuns.size} jobs to analysis...`;
        updateStatus(sendMsg);
        try {
            for (let id of selectedHistoryRuns) {
                await fetch(`/api/jobs/${id}/analyze`, { method: 'POST' });
            }
            const sentSuccessMsg = typeof i18n !== 'undefined' ? i18n.t('jobsSentSuccess', 'Jobs successfully sent to analysis.') : 'Jobs successfully sent to analysis.';
            updateStatus(sentSuccessMsg);
            if(typeof switchTab === 'function') switchTab('jobs');
            fetchJobs();
            return;
        } catch (e) {
            updateStatus(`❌ Error: ${e}`);
            return;
        }
    }

    // Si tenemos un job de discovery o historial cargado en pantalla
    if (window.currentDiscoveryExecutionId) {
        const sendingMsg = typeof i18n !== 'undefined' ? i18n.t('sendingJobsToAnalysis', 'Sending to analysis...').replace('{count}', '1') : 'Sending to analysis...';
        updateStatus(sendingMsg);
        try {
            const response = await fetch(`/api/jobs/${window.currentDiscoveryExecutionId}/analyze`, { method: 'POST' });
            const data = await response.json();
            if (data.success) {
                const jobStartedMsg = typeof i18n !== 'undefined' ? i18n.t('analysisJobStarted', 'Analysis job started') : 'Analysis job started';
                updateStatus(`✅ ${jobStartedMsg} (ID: ${window.currentDiscoveryExecutionId.substring(0,8)}...)`);
                if(typeof switchTab === 'function') switchTab('jobs');
                fetchJobs();
            } else {
                updateStatus(`❌ Error: ${data.error}`);
            }
        } catch(e) {
            const connErr = typeof i18n !== 'undefined' ? i18n.t('connectionError', 'Connection error') : 'Connection error';
            updateStatus(`❌ ${connErr}: ${e}`);
        }
        return;
    }

    // Fallback: si no hay ID, iniciar desde cero (comportamiento original)
    const qs = buildQueryString();
    try {
        const response = await fetch(`/api/jobs/start${qs}`, { method: 'POST' });
        const data = await response.json();
        if (data.run_id) {
            const jobStartedMsg = typeof i18n !== 'undefined' ? i18n.t('jobStartedSuccess', 'Job successfully started') : 'Job successfully started';
            updateStatus(`✅ ${jobStartedMsg} (ID: ${data.run_id.substring(0,8)}...)`);
            if(typeof switchTab === 'function') switchTab('jobs');
            fetchJobs();
        } else {
            updateStatus(`❌ Error: ${data.error}`);
        }
    } catch (err) {
        updateStatus(`❌ Error: ${err}`);
    }
}

// ============================================
// Stage 4: Jobs Queue (Dagster)
// ============================================

async function fetchJobs() {
    try {
        const isStaticDocs = window.location.protocol === 'file:' || window.location.hostname.includes('github.io') || window.location.port !== '5000';
        if (isStaticDocs) {
            if (typeof renderJobsQueue === 'function') renderJobsQueue([]);
            return;
        }
        const response = await fetch('/api/jobs');
        const jobs = await response.json();
        if (typeof renderJobsQueue === 'function') {
            renderJobsQueue(jobs);
        }
    } catch (err) {
        console.error("Error fetching jobs:", err);
    }
}

async function cancelJob(runId) {
    if (!confirm(`Are you sure you want to cancel job ${runId.substring(0,8)}?`)) return;
    try {
        const response = await fetch(`/api/jobs/${runId}/cancel`, { method: 'POST' });
        const data = await response.json();
        if (data.success) {
            fetchJobs();
        } else {
            alert(`Error canceling job: ${data.error}`);
        }
    } catch (err) {
        console.error("Error canceling job:", err);
    }
}

// ============================================
// Downloads
// ============================================

async function exportAll() {
    await downloadExcel();
}

async function downloadExcel() {
    if (collectedArticles.length === 0) return alert("No hay artículos.");

    // Formatear la data (Headers en Español) justo en el momento de la descarga
    const excelData = collectedArticles.map(article => {
        const obj = {
            "Título": article.title || '',
            "Fuente": article.source || '',
            "URL": article.real_url || article.url || '',
            "Fecha de Publicación": article.date || '',
            "Estados Extraídos": article.states && article.states.length > 0 ? article.states.join(', ') : 'Sin localidad',
            "Total de Estados": article.states ? article.states.length : 0
        };
        
        // Incluir campos de enriquecimiento si existen
        if (article.entities_list || article.entities) {
            const entities = article.entities_list || article.entities;
            obj["Entidades Claves"] = Array.isArray(entities) ? entities.map(e => e.entity_text || e).join(', ') : entities;
        }
        if (article.sentiment_score !== undefined) {
            obj["Sentimiento"] = article.sentiment_score;
        }
        
        obj["URL de Imagen"] = article.image_url || article.image || '';

        if (article.origin_search_term) {
            obj["Término de Búsqueda Origen"] = article.origin_search_term;
        }
        return obj;
    });

    const epicenter = document.getElementById('kpiEpicenter') ? document.getElementById('kpiEpicenter').textContent : '';
    const topSource = document.getElementById('kpiTopSource') ? document.getElementById('kpiTopSource').textContent : '';
    const totalLoc = document.getElementById('kpiCoverage') ? document.getElementById('kpiCoverage').textContent : '';

    const payload = {
        articles: excelData,
        images: {},
        params: {
            "Término de Búsqueda": document.getElementById('mainSearchInput')?.value || '',
            "Palabras Secundarias": document.getElementById('secondaryInput')?.value || '',
            "Palabras Excluidas": document.getElementById('excludeInput')?.value || '',
            "Dominio / Sitio": document.getElementById('domainInput')?.value || '',
            "Rango de Fechas": document.getElementById('dateRange')?.value || '',
            "Cantidad Solicitada": document.getElementById('nqueriesInput')?.value || String(collectedArticles.length),
            "Modo de Extracción": typeof currentMode !== 'undefined' && currentMode === 'discovery' ? 'Descubrimiento (Rápido)' : 'Mapeo de Tendencias (NLP)',
            "Total Artículos": collectedArticles.length,
            "Total Locaciones": totalLoc,
            "Epicentro": epicenter,
            "Top Fuente": topSource,
            "Fecha y Hora de Exportación": new Date().toLocaleString()
        }
    };

    // Capture chart images (Maps and Charts)
    try {
        const idsToCapture = [
            { id: 'mapWrapper', filename: 'mapa.png' },
            { id: 'sourceCard', filename: 'chart_sources.png' },
            { id: 'statesCard', filename: 'chart_states.png' },
            { id: 'timelineCard', filename: 'chart_timeline.png' }
        ];

        for (const item of idsToCapture) {
            const el = document.getElementById(item.id);
            if (el) {
                // If it's the map, hide the controls before capture
                let centerBtn, leafletControls;
                if (item.id === 'mapWrapper') {
                    centerBtn = el.querySelector('button[onclick="centerMap()"]');
                    leafletControls = el.querySelector('.leaflet-control-container');
                    if (centerBtn) centerBtn.style.display = 'none';
                    if (leafletControls) leafletControls.style.display = 'none';
                }

                const canvas = await html2canvas(el, { useCORS: true, backgroundColor: '#ffffff' });
                payload.images[item.filename] = canvas.toDataURL("image/png");

                // Restore map controls
                if (item.id === 'mapWrapper') {
                    if (centerBtn) centerBtn.style.display = '';
                    if (leafletControls) leafletControls.style.display = '';
                }
            }
        }
    } catch (e) {
        console.warn("Could not capture all chart images for export.", e);
    }

    const response = await fetch('/download/excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (response.ok) {
        let filename = `news_export_${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15)}.zip`;
        const disposition = response.headers.get('Content-Disposition');
        if (disposition && disposition.indexOf('filename=') !== -1) {
            const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
            if (matches != null && matches[1]) {
                filename = matches[1].replace(/['"]/g, '');
            }
        }
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
    } else {
        alert("Error al descargar.");
    }
}

async function downloadMap() {
    const el = document.getElementById('map');
    try {
        const canvas = await html2canvas(el, { useCORS: true });
        const url = canvas.toDataURL("image/png");
        const a = document.createElement('a');
        a.href = url;
        a.download = 'mapa_tendencias.png';
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
    } catch (err) {
        alert("Error al capturar el mapa.");
    }
}

async function downloadChartCard(cardId, filename) {
    const el = document.getElementById(cardId);
    if (!el) return;
    try {
        const canvas = await html2canvas(el, { useCORS: true, backgroundColor: '#ffffff' });
        const url = canvas.toDataURL("image/png");
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || `${cardId}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
    } catch (err) {
        console.error("Error capturing chart card:", err);
        alert("Error al descargar la gráfica.");
    }
}