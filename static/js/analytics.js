// static/js/analytics.js : Top Sources, Top States + Timeline Area

let sourcesBarChart = null;
let statesBarChart  = null;
let timelineChart   = null;

let sourceCounts   = {};
let stateCounts    = {};
let timelineBuckets = {};

const MD_BLUE  = '#1a73e8';
const MD_GREEN = '#34a853';

const SHARED_TOOLTIP = {
    backgroundColor: '#202124',
    titleFont: { family: 'Roboto', size: 12 },
    bodyFont:  { family: 'Roboto', size: 11 },
    padding: 10,
    cornerRadius: 8,
    displayColors: false,
    // Prevent tooltip from obscuring bars
    position: 'nearest',
    xAlign: 'left',
    yAlign: 'center',
};

// ============================================
// Top 10 Sources — Horizontal Bar Chart
// ============================================

function initSourcesBarChart() {
    const canvas = document.getElementById('sourcesBarCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    sourcesBarChart = new Chart(ctx, {
        type: 'bar',
        data: { labels: [], datasets: [{ label: 'Artículos', data: [], backgroundColor: [], borderRadius: 4 }] },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            onClick: (event, elements) => {
                if (elements.length > 0) {
                    const sourceName = sourcesBarChart.data.labels[elements[0].index];
                    if (window.applyGlobalFilter) window.applyGlobalFilter('source', sourceName);
                }
            },
            onHover: (event, chartElement) => {
                event.native.target.style.cursor = chartElement[0] ? 'pointer' : 'default';
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    ...SHARED_TOOLTIP,
                    intersect: false,
                    callbacks: { label: ctx => `${ctx.parsed.x} artículo${ctx.parsed.x !== 1 ? 's' : ''}` }
                }
            },
            scales: {
                x: { grid: { display: false }, ticks: { font: { family: 'Roboto', size: 11 }, precision: 0 } },
                y: { grid: { display: false }, ticks: { font: { family: 'Roboto', size: 11 }, mirror: false } }
            }
        }
    });
}

function updateSourcesBar(sourceName) {
    if (!sourceName || !sourcesBarChart) return;
    sourceCounts[sourceName] = (sourceCounts[sourceName] || 0) + 1;

    const sorted = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const labels = sorted.map(e => e[0]);
    const data   = sorted.map(e => e[1]);
    const maxVal = Math.max(...data, 1);

    sourcesBarChart.data.labels = labels;
    sourcesBarChart.data.datasets[0].data = data;
    sourcesBarChart.data.datasets[0].backgroundColor = data.map(v => {
        const alpha = 0.25 + (v / maxVal) * 0.75;
        return `rgba(26, 115, 232, ${alpha.toFixed(2)})`;
    });
    sourcesBarChart.update('none');
}

// ============================================
// Top 10 States — Horizontal Bar Chart
// ============================================

function initStatesBarChart() {
    const canvas = document.getElementById('statesBarCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    statesBarChart = new Chart(ctx, {
        type: 'bar',
        data: { labels: [], datasets: [{ label: 'Menciones', data: [], backgroundColor: [], borderRadius: 4 }] },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            onClick: (event, elements) => {
                if (elements.length > 0) {
                    const stateName = statesBarChart.data.labels[elements[0].index];
                    if (window.applyGlobalFilter) window.applyGlobalFilter('state', stateName);
                }
            },
            onHover: (event, chartElement) => {
                event.native.target.style.cursor = chartElement[0] ? 'pointer' : 'default';
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    ...SHARED_TOOLTIP,
                    intersect: false,
                    callbacks: { label: ctx => `${ctx.parsed.x} mención${ctx.parsed.x !== 1 ? 'es' : ''}` }
                }
            },
            scales: {
                x: { grid: { display: false }, ticks: { font: { family: 'Roboto', size: 11 }, precision: 0 } },
                y: { grid: { display: false }, ticks: { font: { family: 'Roboto', size: 11 } } }
            }
        }
    });
}

function updateStatesBar(statesArray) {
    if (!statesArray || !statesArray.length || !statesBarChart) return;
    statesArray.forEach(state => {
        if (state) stateCounts[state] = (stateCounts[state] || 0) + 1;
    });

    const sorted = Object.entries(stateCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const labels = sorted.map(e => e[0]);
    const data   = sorted.map(e => e[1]);
    const maxVal = Math.max(...data, 1);

    statesBarChart.data.labels = labels;
    statesBarChart.data.datasets[0].data = data;
    statesBarChart.data.datasets[0].backgroundColor = data.map(v => {
        const alpha = 0.25 + (v / maxVal) * 0.75;
        return `rgba(52, 168, 83, ${alpha.toFixed(2)})`;
    });
    statesBarChart.update('none');
}

// ============================================
// Timeline — Area Chart
// ============================================

function initTimelineChart() {
    const canvas = document.getElementById('timelineCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    timelineChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Volumen', data: [], fill: true,
                backgroundColor: 'rgba(26, 115, 232, 0.12)', borderColor: MD_BLUE,
                borderWidth: 2, tension: 0.4, pointBackgroundColor: MD_BLUE,
                pointRadius: 3, pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    ...SHARED_TOOLTIP,
                    intersect: false,
                    mode: 'index',
                    xAlign: 'left',
                    yAlign: 'bottom',
                    callbacks: { label: ctx => `${ctx.parsed.y} artículo${ctx.parsed.y !== 1 ? 's' : ''}` }
                }
            },
            scales: {
                x: { grid: { display: false }, ticks: { font: { family: 'Roboto', size: 11 }, maxTicksLimit: 12 } },
                y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Roboto', size: 11 }, precision: 0 } }
            }
        }
    });
}

function updateTimeline(dateStr) {
    if (!dateStr || !timelineChart) return;
    let bucket;
    try {
        const d = new Date(dateStr);
        bucket = isNaN(d.getTime()) ? dateStr.substring(0, 10) : d.toISOString().substring(0, 10);
    } catch { bucket = dateStr.substring(0, 10); }

    timelineBuckets[bucket] = (timelineBuckets[bucket] || 0) + 1;
    const sorted = Object.entries(timelineBuckets).sort((a, b) => a[0].localeCompare(b[0]));
    timelineChart.data.labels = sorted.map(e => e[0]);
    timelineChart.data.datasets[0].data = sorted.map(e => e[1]);
    timelineChart.update('none');
}

// ============================================
// Global Reset
// ============================================
function resetAnalytics() {
    sourceCounts    = {};
    stateCounts     = {};
    timelineBuckets = {};

    if (sourcesBarChart) { sourcesBarChart.data.labels = []; sourcesBarChart.data.datasets[0].data = []; sourcesBarChart.update('none'); }
    if (statesBarChart)  { statesBarChart.data.labels  = []; statesBarChart.data.datasets[0].data  = []; statesBarChart.update('none'); }
    if (timelineChart)   { timelineChart.data.labels   = []; timelineChart.data.datasets[0].data   = []; timelineChart.update('none'); }
}

// ============================================
// Init
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    initSourcesBarChart();
    initStatesBarChart();
    initTimelineChart();
});