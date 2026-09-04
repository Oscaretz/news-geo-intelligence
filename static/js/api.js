// static/js/api.js — Handles fetch, EventSource, and file downloads

function buildQueryString() {
    const query = document.getElementById('mainSearchInput')?.value ?? '';
    const qoption = document.getElementById('secondaryInput')?.value ?? '';
    const qexception = document.getElementById('excludeInput')?.value ?? '';
    const qsite = document.getElementById('domainInput')?.value ?? '';
    const qrangedate = document.getElementById('dateRange')?.value ?? '';
    const nqueries = document.getElementById('nqueriesInput')?.value ?? '';
    const country = document.querySelector('input[name="countryToggle"]:checked')?.value ?? '';

    return `?query=${encodeURIComponent(query.trim())}` +
           `&qoption=${encodeURIComponent(qoption.trim())}` +
           `&qexception=${encodeURIComponent(qexception.trim())}` +
           `&qsite=${encodeURIComponent(qsite.trim())}` +
           `&qrangedate=${encodeURIComponent(qrangedate.trim())}` +
           `&nqueries=${encodeURIComponent(nqueries.trim())}` +
           `&country=${encodeURIComponent(country.trim())}`;
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
        const data = await response.json();

        if (typeof loadMapForCountry === 'function') {
            await loadMapForCountry(countryChecked.value);
        }

        //updateStatus(`✅ ${data.length} artículos encontrados.`);
        updateStatus(`Artículos recolectados con éxito.`);
        setTimeout(() => {
            const statusBox = document.getElementById('statusBox');
            if (statusBox) statusBox.style.display = 'none';
        }, 3000);

        if (data.length === 0) {
            renderTopStories([], "No articles found matching your criteria.");
            renderFullFeed();
        } else {
            data.forEach(article => {
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
        updateStatus(`❌ Error de conexión.`);
    } finally {
        window._isFetching = false;
    }
}

// ============================================
// Stage 2: Mapping (EventSource)
// ============================================

async function startStreamMapping() {
    resetUI('mapping');
    
    // Ensure map and GeoJSON are loaded for the selected country before streaming starts
    const countryChecked = document.querySelector('input[name="countryToggle"]:checked');
    if (countryChecked && typeof loadMapForCountry === 'function') {
        await loadMapForCountry(countryChecked.value);
    }
    
    const qs = buildQueryString();
    const eventSource = new EventSource(`/stream${qs}`);

    eventSource.onmessage = function(event) {
        const data = JSON.parse(event.data);

        if (data.type === 'update') {
            updateStatus(data.message);
        }
        else if (data.type === 'article') {
            const article = data.data;
            
            renderArticle(article, 'mapping'); // ui.js guarda el artículo en crudo aquí
            updateKPIs(article);
            if (typeof updateMap === 'function') updateMap(article.states);
            
            updateSourcesBar(article.source);
            updateStatesBar(article.states); // NUEVO: Alimentar gráfica de Estados
            updateTimeline(article.date);
        }
        else if (data.type === 'complete' || data.type === 'error') {
            eventSource.close();
            if (data.type === 'error') {
                updateStatus(`❌ ${data.message}`);
            } else {
                updateStatus('All processing complete!');
                document.getElementById('actionButtons').style.display = 'flex';
                const exportBtn = document.getElementById('exportExcelBtn');
                if (exportBtn) exportBtn.classList.remove('hidden');
                const mapearBtn = document.getElementById('mapearBtn');
                if (mapearBtn) mapearBtn.classList.remove('hidden');
            }
        }
    };

    eventSource.onerror = function() {
        eventSource.close();
        updateStatus(`❌ Conexión perdida.`);
    };
}

// ============================================
// Downloads
// ============================================

async function exportAll() {
    await downloadExcel();
    await downloadMap();
}

async function downloadExcel() {
    if (collectedArticles.length === 0) return alert("No hay artículos.");

    // Formatear la data (Headers en Español) justo en el momento de la descarga
    const excelData = collectedArticles.map(article => ({
        "Identificador Único": article.guid || '',
        "Título": article.title || '',
        "Fuente": article.source || '',
        "URL de Google": article.url || '',
        "URL Real": article.real_url || '',
        "Fecha de Publicación": article.date || '',
        "Estados Extraídos": article.states && article.states.length > 0 ? article.states.join(', ') : 'Sin localidad',
        "Ruta de Imagen": article.image ? article.image.split('/').pop().split('\\').pop() : ''
    }));

    const payload = {
        articles: excelData,
        params: {
            "Término de Búsqueda": document.getElementById('mainSearchInput')?.value || '',
            "Palabras Secundarias": document.getElementById('secondaryInput')?.value || '',
            "Palabras Excluidas": document.getElementById('excludeInput')?.value || '',
            "Dominio / Sitio": document.getElementById('domainInput')?.value || '',
            "Rango de Fechas": document.getElementById('dateRange')?.value || '',
            "Cantidad Solicitada": document.getElementById('nqueriesInput')?.value || '15',
            "Modo de Extracción": currentMode === 'discovery' ? 'Descubrimiento (Rápido)' : 'Mapeo de Tendencias (NLP)',
            "Total Artículos": collectedArticles.length,
            "Fecha y Hora de Exportación": new Date().toLocaleString()
        }
    };

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