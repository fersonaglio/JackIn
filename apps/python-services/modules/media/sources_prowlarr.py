#!/usr/bin/env python3
"""Prowlarr torrent search source.

Fetches torrents from a Prowlarr instance (self-hosted indexer aggregator).
Best-effort fetcher returning a list of `{name, seeders, size, info_hash}`
dicts. When not configured or on any failure it returns an empty list.

Configuration (environment variables, no config file needed):
  - PROWLARR_URL      base URL, default http://localhost:9696
  - PROWLARR_API_KEY  required; if missing/empty no request is made
  - ENABLE_PROWLARR   set to "0" to disable
"""
import json
import os
import re
import urllib.parse
import urllib.request

from config import get_unverified_context, get_session

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

_BTIH_RE = re.compile(r"btih:([a-fA-F0-9]{40})")


def parse_prowlarr_response(json_items: list) -> list:
    """Normalize raw Prowlarr search API items into torrent dicts.

    Each raw item typically carries `title`, `seeders`, `size`, `magnetUrl`,
    `infoHash` and `indexer`. Items without a usable info hash are skipped.
    """
    results = []
    for item in json_items or []:
        if not isinstance(item, dict):
            continue
        info_hash = (item.get("infoHash") or "").strip()
        if not info_hash:
            m = _BTIH_RE.search(item.get("magnetUrl") or "")
            if m:
                info_hash = m.group(1)
        info_hash = info_hash.lower()
        if not re.fullmatch(r"[a-f0-9]{40}", info_hash):
            continue
        name = (item.get("title") or "").strip()
        if not name:
            continue
        seeders = item.get("seeders")
        seeders = str(seeders) if seeders is not None else "0"
        size = item.get("size", 0)
        try:
            size = int(size or 0)
        except (TypeError, ValueError):
            size = 0
        results.append({
            "name": name,
            "seeders": seeders,
            "size": str(size),
            "info_hash": info_hash,
        })
    return results


def search_prowlarr(query: str) -> list:
    """Search Prowlarr and return normalized torrent dicts (best effort)."""
    if os.environ.get("ENABLE_PROWLARR", "1") == "0":
        return []
    api_key = (os.environ.get("PROWLARR_API_KEY") or "").strip()
    if not api_key:
        return []
    base = (os.environ.get("PROWLARR_URL") or "http://localhost:9696").strip().rstrip("/")
    encoded = urllib.parse.quote(query.strip())
    url = f"{base}/api/v1/search?query={encoded}&limit=100&type=search"
    data = None
    try:
        session = get_session()
        r = session.get(url, headers={"X-Api-Key": api_key, "User-Agent": UA}, timeout=(2.0, 3.5))
        if r.status_code == 200:
            data = r.json()
    except Exception:
        pass
    if data is None:
        try:
            req = urllib.request.Request(url, headers={"X-Api-Key": api_key, "User-Agent": UA})
            with urllib.request.urlopen(req, context=get_unverified_context(), timeout=3.5) as res:
                body = res.read().decode("utf-8", "replace")
            data = json.loads(body)
        except Exception:
            return []
    if not isinstance(data, list):
        return []
    return parse_prowlarr_response(data)

