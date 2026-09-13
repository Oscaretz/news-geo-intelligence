with open("static/js/map.js", "r", encoding="utf-8") as f:
    code = f.read()

new_func = """function renderChoropleth() {
    if (!geojsonLayer) return;
    geojsonLayer.setStyle(styleFeature);
    setTimeout(() => { if (map) map.invalidateSize(); }, 150);
}

window.invalidateMapSize = function() {
    if (map) {
        map.invalidateSize();
        if (currentCountryConfig && currentCountryConfig.center) {
            map.setView(currentCountryConfig.center, currentCountryConfig.zoom || 4);
        }
    }
};
"""
code = code.replace("""function renderChoropleth() {
    if (!geojsonLayer) return;
    geojsonLayer.setStyle(styleFeature);
    setTimeout(() => { if (map) map.invalidateSize(); }, 150);
}""", new_func)

with open("static/js/map.js", "w", encoding="utf-8") as f:
    f.write(code)
