// static/js/map.js — Leaflet Choropleth Map using GeoJSON

let map = null;
let geojsonLayer = null;
let geoJsonData = null;
let mapStateCounts = {};
let currentCountryConfig = null;

function isValidCenter(center) {
    return Array.isArray(center) && center.length >= 2 && !isNaN(center[0]) && !isNaN(center[1]);
}


// Use a ResizeObserver to ensure Leaflet recalculates bounds when the map container becomes visible or changes size
const mapObserver = new ResizeObserver(() => {
    if (map) {
        map.invalidateSize();
        if (currentCountryConfig && isValidCenter(currentCountryConfig.center)) {
            map.setView(currentCountryConfig.center, currentCountryConfig.zoom || 5);
        }
    }
});

function initMap(force = false) {
    const mapContainer = document.getElementById('map');
    if (!mapContainer) return;
    if (!force && mapContainer.offsetWidth === 0) return;

    if (!map) {
        let center = [23.6345, -102.5528];
        let zoom = 5;
        if (currentCountryConfig && isValidCenter(currentCountryConfig.center)) {
            center = currentCountryConfig.center;
            zoom = currentCountryConfig.zoom || 5;
        }
        map = L.map('map', { zoomControl: false }).setView(center, zoom);
        L.control.zoom({ position: 'bottomright' }).addTo(map);
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
            maxZoom: 16
        }).addTo(map);
        
        mapObserver.observe(mapContainer);
        
        if (geoJsonData && !geojsonLayer) {
            createGeoJsonLayer();
        }
    }

    
    // Always synchronously invalidate size if forced to ensure Leaflet has dimensions before any flyTo
    if (force) {
        map.invalidateSize();
    } else {
        setTimeout(() => { if (map) map.invalidateSize(); }, 300);
    }
}

async function loadMapForCountry(countryKey) {
    const key = (countryKey && typeof countryKey === 'string' && countryKey.trim()) ? countryKey.trim() : 'mx';
    if (!map) initMap(true);
    
    // Ensure map size is updated before performing animations
    if (map) map.invalidateSize();

    try {
        const fullConfigRes = await fetch('/static/maps/map_config.json');
        const fullConfig = await fullConfigRes.json();
        currentCountryConfig = fullConfig[key] || fullConfig['mx'];

        if (map && currentCountryConfig && isValidCenter(currentCountryConfig.center)) {
            map.setView(currentCountryConfig.center, currentCountryConfig.zoom || 5);
        }

        const geoRes = await fetch(`/static/maps/${key}_states.geojson`);
        if (!geoRes.ok) {
            console.error(`Failed to fetch geojson for ${key}: HTTP ${geoRes.status}`);
            return;
        }
        geoJsonData = await geoRes.json();
        
        if (map) {
            createGeoJsonLayer();
        }
    } catch (e) {
        console.error("Error loading map for country:", key, e);
    }
}

function normalizeText(text) {
    if (!text) return '';
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function matchGeoJsonState(stateName) {
    if (!stateName) return null;
    const sNorm = normalizeText(stateName);

    if (geoJsonData && geoJsonData.features) {
        // Pass 1: Exact match
        let found = geoJsonData.features.find(f => normalizeText(f.properties.state_name) === sNorm);
        if (found) return found.properties.state_name;
        
        // Pass 2: Substring match (careful with false positives like Baja California Sur -> Baja California)
        found = geoJsonData.features.find(f => {
            const fNorm = normalizeText(f.properties.state_name);
            
            if (sNorm.includes('baja california') && fNorm.includes('baja california')) {
                const sHasSur = sNorm.includes('sur');
                const fHasSur = fNorm.includes('sur');
                if (sHasSur !== fHasSur) return false;
            }
            
            // Prevent 'mexico' alone from matching 'ciudad de mexico' first (which comes earlier in GeoJSON)
            if (sNorm === 'mexico' && fNorm === 'ciudad de mexico') return false;
            
            return fNorm === sNorm || fNorm.includes(sNorm) || sNorm.includes(fNorm);
        });
        if (found) return found.properties.state_name;
    }
    return stateName;
}

function getStateCount(stateName) {
    if (!stateName) return 0;
    if (mapStateCounts[stateName]) return mapStateCounts[stateName];

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
        return '#e8eaed';
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
    const displayName = stateName;

    layer.bindTooltip(() => {
        const count = getStateCount(stateName);
        return `<div class="p-1 font-sans">
            <div class="font-semibold text-xs text-gray-900">${displayName}</div>
            <div class="text-[11px] text-gray-600">${count} ${count === 1 ? 'noticia' : 'noticias'}</div>
        </div>`;
    }, {
        sticky: true,
        direction: 'auto',
        className: 'custom-map-tooltip',
        interactive: false
    });

    layer.on({
        mouseover: function (e) {
            const l = e.target;
            l.setStyle({
                weight: 2.5,
                color: '#1a73e8',
                fillOpacity: 0.9
            });
            // Removed bringToFront() because mutating DOM order during hover causes 
            // the browser to fire errant mouseout events, creating sticky hover bugs.
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
            if (typeof window.applyGlobalFilter === 'function') {
                window.applyGlobalFilter('state', stateName);
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
        } else {
            mapStateCounts[state] = (mapStateCounts[state] || 0) + 1;
        }
    });

    if (!geojsonLayer && geoJsonData && map) {
        createGeoJsonLayer();
    } else {
        renderChoropleth();
    }
}

function renderChoropleth() {
    if (!geojsonLayer) return;
    geojsonLayer.setStyle(styleFeature);
}

window.invalidateMapSize = function() {
    if (map) {
        setTimeout(() => {
            map.invalidateSize();
            if (currentCountryConfig && isValidCenter(currentCountryConfig.center)) {
                map.setView(currentCountryConfig.center, currentCountryConfig.zoom || 5);
            }
            if (geojsonLayer) {
                geojsonLayer.setStyle(styleFeature);
            }
        }, 200); // Allow browser time to reflow layout
    }
};


// Alias for backwards compatibility
function renderHeatMap() {
    renderChoropleth();
}

function centerMap() {
    if (map) {
        const size = map.getSize();
        if (currentCountryConfig && isValidCenter(currentCountryConfig.center)) {
            if (size.x === 0 || size.y === 0) {
                map.setView(currentCountryConfig.center, currentCountryConfig.zoom || 4);
            } else {
                map.flyTo(currentCountryConfig.center, currentCountryConfig.zoom || 4, { animate: true, duration: 1.2 });
            }
        } else {
            if (size.x === 0 || size.y === 0) {
                map.setView([0, 0], 2);
            } else {
                map.flyTo([0, 0], 2, { animate: true, duration: 1.2 });
            }
        }
    }
}