"""
geojson_cache.py — Application-level in-memory singleton for GeoJSON + map config.

Eliminates redundant filesystem I/O: files are read exactly once at import time
(or on first call to get_geojson / get_map_config) and kept in module-level
memory for the lifetime of the process.

Usage:
    from static.py.geojson_cache import get_geojson, get_map_config, get_valid_regions

    geojson = get_geojson("mx")          # dict  — full GeoJSON FeatureCollection
    config  = get_map_config("mx")       # dict  — entry from map_config.json
    regions = get_valid_regions("mx")    # list[str] — state_name values
"""

import json
import logging
import os
from pathlib import Path
from threading import Lock
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Absolute base: this file lives at  static/py/geojson_cache.py
_BASE_DIR: Path = Path(__file__).resolve().parents[2]   # → project root
_MAPS_DIR: Path = _BASE_DIR / "static" / "maps"

# ---------------------------------------------------------------------------
# Module-level singletons (populated lazily, thread-safe)
# ---------------------------------------------------------------------------
_map_config: Optional[Dict[str, Any]] = None
_geojson_store: Dict[str, Any] = {}          # keyed by country code
_valid_regions_store: Dict[str, List[str]] = {}

_config_lock = Lock()
_geojson_lock = Lock()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_map_config(country: str = "mx") -> Dict[str, Any]:
    """Return the config dict for *country* from map_config.json (cached)."""
    global _map_config
    if _map_config is None:
        _load_map_config()
    return _map_config.get(country.lower(), _map_config.get("mx", {}))


def get_full_map_config() -> Dict[str, Any]:
    """Return the entire parsed map_config.json dict (cached)."""
    global _map_config
    if _map_config is None:
        _load_map_config()
    return _map_config


def get_geojson(country: str = "mx") -> Dict[str, Any]:
    """Return the parsed GeoJSON FeatureCollection for *country* (cached)."""
    key = country.lower()
    if key not in _geojson_store:
        _load_geojson(key)
    return _geojson_store.get(key, {})


def get_valid_regions(country: str = "mx") -> List[str]:
    """Return the list of state_name strings for *country* (cached)."""
    key = country.lower()
    if key not in _valid_regions_store:
        _load_geojson(key)
    return _valid_regions_store.get(key, [])


def get_available_countries() -> List[str]:
    """Return country keys that have a corresponding GeoJSON file on disk."""
    global _map_config
    if _map_config is None:
        _load_map_config()
    available = []
    for key in _map_config:
        geojson_path = _MAPS_DIR / f"{key}_states.geojson"
        if geojson_path.exists():
            available.append(key)
    return available


def preload_all() -> None:
    """
    Eagerly load all GeoJSON files present on disk.
    Call once during application startup so the first API request is not
    subject to disk I/O latency.
    """
    global _map_config
    if _map_config is None:
        _load_map_config()
    for key in _map_config:
        geojson_path = _MAPS_DIR / f"{key}_states.geojson"
        if geojson_path.exists() and key not in _geojson_store:
            _load_geojson(key)
    logger.info(
        f"[geojson_cache] Preloaded {len(_geojson_store)} GeoJSON file(s): "
        f"{list(_geojson_store.keys())}"
    )


# ---------------------------------------------------------------------------
# Internal loaders (idempotent, thread-safe)
# ---------------------------------------------------------------------------

def _load_map_config() -> None:
    global _map_config
    with _config_lock:
        if _map_config is not None:
            return
        config_path = _MAPS_DIR / "map_config.json"
        try:
            with open(config_path, "r", encoding="utf-8") as fh:
                _map_config = json.load(fh)
            logger.info(f"[geojson_cache] Loaded map_config.json ({len(_map_config)} countries)")
        except Exception as exc:
            logger.error(f"[geojson_cache] Failed to load map_config.json: {exc}")
            _map_config = {"mx": {"gl": "MX", "hl": "es", "ceid": "MX:es"}}


def _load_geojson(key: str) -> None:
    with _geojson_lock:
        if key in _geojson_store:
            return
        geojson_path = _MAPS_DIR / f"{key}_states.geojson"
        try:
            with open(geojson_path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            _geojson_store[key] = data
            _valid_regions_store[key] = [
                feat["properties"]["state_name"]
                for feat in data.get("features", [])
                if feat.get("properties", {}).get("state_name")
            ]
            size_kb = geojson_path.stat().st_size // 1024
            logger.info(
                f"[geojson_cache] Loaded {key}_states.geojson "
                f"({size_kb} KB, {len(_valid_regions_store[key])} regions) into memory"
            )
        except FileNotFoundError:
            logger.warning(f"[geojson_cache] GeoJSON file not found: {geojson_path}")
            _geojson_store[key] = {}
            _valid_regions_store[key] = []
        except Exception as exc:
            logger.error(f"[geojson_cache] Failed to load {key}_states.geojson: {exc}")
            _geojson_store[key] = {}
            _valid_regions_store[key] = []
