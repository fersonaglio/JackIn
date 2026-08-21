#!/usr/bin/env python3
"""Torrentio search source for JackIn media services.

Fetches high-quality, verified streams from Torrentio with real-time seeder counts,
exact file sizes, HDR/4K/1080p metadata, and multilingual (including PT-BR / Dublado) tags.
"""
import json
import re
import urllib.parse
import urllib.request
from config import get_unverified_context, get_session, INSECURE_SSL

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

_CACHE = {}
_CACHE_TTL = 300  # 5 minutes


def _cache_get(key):
    item = _CACHE.get(key)
    if item and item[1] > (time.time() if "time" in globals() else 0):
        return item[0]
    return None


import time


def _cache_set(key, value):
    _CACHE[key] = (value, time.time() + _CACHE_TTL)


def _get_imdb_id(query: str, is_series_query: bool = False) -> str | None:
    """Resolve IMDB ID for a query via Cinemeta."""
    clean_q = query.strip()
    if not clean_q:
        return None
    encoded = urllib.parse.quote(clean_q)
    cat = "series" if is_series_query else "movie"
    url = f"https://v3-cinemeta.strem.io/catalog/{cat}/top/search={encoded}.json"
    try:
        session = get_session()
        r = session.get(url, timeout=(2.0, 3.5), headers={"User-Agent": UA})
        if r.status_code == 200:
            data = r.json()
            metas = data.get("metas", [])
            if metas:
                return metas[0].get("id") or metas[0].get("imdb_id")
    except Exception:
        pass

    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, context=get_unverified_context(), timeout=3.5) as res:
            data = json.loads(res.read().decode("utf-8", "replace"))
            metas = data.get("metas", [])
            if metas:
                return metas[0].get("id") or metas[0].get("imdb_id")
    except Exception:
        return None
    return None


def search_torrentio(query: str, is_series_query: bool = False) -> list:
    """Search Torrentio for live streams with verified seeders."""
    cached = _cache_get(query)
    if cached is not None:
        return cached

    imdb_id = _get_imdb_id(query, is_series_query)
    if not imdb_id or not imdb_id.startswith("tt"):
        return []

    cat = "series" if is_series_query else "movie"
    stream_url = f"https://torrentio.strem.fun/stream/{cat}/{imdb_id}.json"
    data = None
    try:
        session = get_session()
        r = session.get(stream_url, timeout=(2.5, 4.0), headers={"User-Agent": UA})
        if r.status_code == 200:
            data = r.json()
    except Exception:
        pass

    if data is None:
        try:
            req = urllib.request.Request(stream_url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, context=get_unverified_context(), timeout=4.0) as res:
                data = json.loads(res.read().decode("utf-8", "replace"))
        except Exception:
            return []

    if not isinstance(data, dict):
        return []

    results = []
    for s in data.get("streams", []):
        info_hash = (s.get("infoHash") or "").lower().strip()
        if not info_hash or len(info_hash) != 40:
            continue

        title_raw = s.get("title", "")
        lines = [l.strip() for l in title_raw.split("\n") if l.strip()]
        name = lines[0] if lines else s.get("name", "")
        # If there are release detail lines with dub/sub hints or Portuguese flags, include them in the title
        for extra_line in lines[1:]:
            if any(k in extra_line.upper() for k in ("DUBLADO", "DUAL", "PORTUGU", "PT-BR", "BRA", "LEGENDADO")) or "🇵🇹" in extra_line or "🇧🇷" in extra_line:
                name += f" [{extra_line}]"

        # Parse seeders from "👤 55"
        seed_m = re.search(r"👤\s*(\d+)", title_raw)
        seeders = seed_m.group(1) if seed_m else "0"

        # Parse size from "💾 2.29 GB"
        size_m = re.search(r"💾\s*([\d.]+)\s*(TB|GB|MB|KB)", title_raw, re.I)
        if size_m:
            val = float(size_m.group(1))
            u = size_m.group(2).upper()
            mult = {"TB": 1024**4, "GB": 1024**3, "MB": 1024**2, "KB": 1024}.get(u, 1)
            size_bytes = int(val * mult)
        else:
            size_bytes = 0

        results.append({
            "name": name,
            "seeders": seeders,
            "size": str(size_bytes),
            "info_hash": info_hash,
        })

    _cache_set(query, results)
    return results
