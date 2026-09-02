// static/js/map.js — Leaflet Choropleth Map using GeoJSON

let map = null;
let geojsonLayer = null;
let geoJsonData = null;
let mapStateCounts = {};

function initMap() {
    const mapContainer = document.getElementById('map');
    if (!mapContainer || mapContainer.offsetWidth === 0) return;

    if (!map) {
        map = L.map('map', { zoomControl: false }).setView([23.6345, -102.5528], 5);
        L.control.zoom({ position: 'bottomright' }).addTo(map);
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
            maxZoom: 16
        }).addTo(map);
    }

    if (!geoJsonData) {
        fetch('/static/maps/mexicostates.geojson')
            .then(res => res.json())
            .then(data => {
                geoJsonData = data;
                createGeoJsonLayer();
            })
            .catch(err => console.error("Error loading mexicostates.geojson:", err));
    } else if (!geojsonLayer) {
        createGeoJsonLayer();
    }

    setTimeout(() => { if (map) map.invalidateSize(); }, 300);
}

function normalizeText(text) {
    if (!text) return '';
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function matchGeoJsonState(stateName) {
    if (!stateName) return null;
    const sNorm = normalizeText(stateName);

    if (sNorm === 'cdmx' || sNorm === 'ciudad de mexico' || sNorm === 'distrito federal' || sNorm === 'df') {
        return 'Distrito Federal';
    }
    if (sNorm === 'michoacan' || sNorm === 'michoacan de ocampo') {
        return 'Michoacán de Ocampo';
    }
    if (sNorm === 'veracruz' || sNorm.includes('veracruz')) {
        return 'Veracruz de Ignacio de la Llave';
    }
    if (sNorm === 'coahuila' || sNorm.includes('coahuila')) {
        return 'Coahuila de Zaragoza';
    }
    if (sNorm === 'mexico' || sNorm === 'estado de mexico' || sNorm === 'edomex') {
        return 'México';
    }

    if (geoJsonData && geoJsonData.features) {
        const found = geoJsonData.features.find(f => {
            const fNorm = normalizeText(f.properties.state_name);
            return fNorm === sNorm || fNorm.includes(sNorm) || sNorm.includes(fNorm);
        });
        if (found) return found.properties.state_name;
    }

    return stateName;
}

function getStateCount(stateName) {
    if (!stateName) return 0;
    if (mapStateCounts[stateName]) return mapStateCounts[stateName];

    // Fallback matching by normalization
    const sNorm = normalizeText(stateName);
    for (const key of Object.keys(mapStateCounts)) {
        if (normalizeText(key) === sNorm || matchGeoJsonState(key) === stateName) {
            return mapStateCounts[key];
        }
    }
    return 0;
}

function getMaxStateCount() {
    const counts = Object.values(mapStateCounts);
    return counts.length ? Math.max(...counts, 1) : 1;
}

function getChoroplethColor(count, maxCount) {
    if (!count || count <= 0) {
        return '#e8eaed'; // Neutral base
    }
    const ratio = maxCount > 1 ? (count / maxCount) : 1;
    if (ratio >= 0.8) return '#174ea6';
    if (ratio >= 0.6) return '#1a73e8';
    if (ratio >= 0.4) return '#4285f4';
    if (ratio >= 0.2) return '#8ab4f8';
    return '#c6dafc';
}

function styleFeature(feature) {
    const stateName = feature.properties.state_name;
    const count = getStateCount(stateName);
    const maxCount = getMaxStateCount();
    const isHighlighted = count > 0;

    return {
        fillColor: getChoroplethColor(count, maxCount),
        weight: isHighlighted ? 1.5 : 1,
        opacity: 1,
        color: isHighlighted ? '#1a73e8' : '#c1c6d6',
        fillOpacity: isHighlighted ? 0.75 : 0.45
    };
}

function onEachFeature(feature, layer) {
    const stateName = feature.properties.state_name;
    const displayName = stateName === 'Distrito Federal' ? 'Ciudad de México' : stateName;

    layer.bindTooltip(() => {
        const count = getStateCount(stateName);
        return `<div class="p-1 font-sans">
            <div class="font-semibold text-xs text-gray-900">${displayName}</div>
            <div class="text-[11px] text-gray-600">${count} ${count === 1 ? 'noticia' : 'noticias'}</div>
        </div>`;
    }, {
        sticky: true,
        direction: 'auto',
        className: 'custom-map-tooltip'
    });

    layer.on({
        mouseover: function (e) {
            const l = e.target;
            l.setStyle({
                weight: 2.5,
                color: '#1a73e8',
                fillOpacity: 0.9
            });
            if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) {
                l.bringToFront();
            }
        },
        mouseout: function (e) {
            if (geojsonLayer) {
                geojsonLayer.resetStyle(e.target);
            }
        },
        click: function (e) {
            if (map) {
                map.fitBounds(e.target.getBounds(), { maxZoom: 7, animate: true });
            }
        }
    });
}

function createGeoJsonLayer() {
    if (!map || !geoJsonData) return;
    if (geojsonLayer) {
        map.removeLayer(geojsonLayer);
    }

    geojsonLayer = L.geoJSON(geoJsonData, {
        style: styleFeature,
        onEachFeature: onEachFeature
    }).addTo(map);

    renderChoropleth();
}

function resetMapState() {
    mapStateCounts = {};
    renderChoropleth();
}

function updateMap(states) {
    if (!states || !states.length) return;

    states.forEach(state => {
        if (!state) return;
        const matched = matchGeoJsonState(state);
        if (matched) {
            mapStateCounts[matched] = (mapStateCounts[matched] || 0) + 1;
        }
    });

    renderChoropleth();
}

function renderChoropleth() {
    if (!geojsonLayer) return;
    geojsonLayer.setStyle(styleFeature);
    setTimeout(() => { if (map) map.invalidateSize(); }, 150);
}

// Alias for backwards compatibility
function renderHeatMap() {
    renderChoropleth();
}

function centerMap() {
    if (map) {
        map.flyTo([23.6345, -102.5528], 5, { animate: true, duration: 1.2 });
    }
}