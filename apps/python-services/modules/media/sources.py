#!/usr/bin/env python3
"""Pluggable multi-source torrent search.

Each source is a best-effort fetcher returning a list of
`{name, seeders, size, info_hash}` dicts. Sources run in parallel and failures
are isolated (a broken source never breaks the others). Results are merged and
deduplicated by infohash, and cached in-memory with a TTL to avoid rate limits.
"""
import json
import os
import re
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

from config import MEDIA_APIS, get_unverified_context

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

_CACHE = {}
_CACHE_TTL = 300  # seconds


def _cache_get(key):
    item = _CACHE.get(key)
    if item and item[1] > time.time():
        return item[0]
    return None


def _cache_set(key, value):
    _CACHE[key] = (value, time.time() + _CACHE_TTL)


def _get(url, timeout=10, is_json=True):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, context=get_unverified_context(), timeout=timeout) as res:
        body = res.read().decode("utf-8", "replace")
    return json.loads(body) if is_json else body


def decode_title(name: str) -> str:
    """Fix double-encoded HTML entities in torrent names.

    Brazilian uploaders often escape titles twice, so "Anéis" arrives as
    "An&Atilde;&copy;is" (or plain "&atilde;"). We unescape HTML, then try to
    repair the UTF-8-as-Latin-1 mojibake produced by that double escape.
    """
    if not name:
        return name
    import html as _html
    s = _html.unescape(name)
    if "Ã©" in s or "Ã£" in s or "Ã¡" in s or "Ãµ" in s or "Ã­" in s:
        try:
            s = s.encode("latin-1").decode("utf-8")
        except Exception:
            pass
    return s


_APIBAY_BREAKER = {"fails": 0, "off_until": 0.0}


def fetch_apibay(query: str) -> list:
    if time.time() < _APIBAY_BREAKER["off_until"]:
        return []
    encoded = urllib.parse.quote(query.strip().lower())
    url = f"{MEDIA_APIS['apibay']}/q.php?q={encoded}"
    try:
        data = _get(url, timeout=3, is_json=True)
        _APIBAY_BREAKER["fails"] = 0
    except Exception:
        _APIBAY_BREAKER["fails"] += 1
        if _APIBAY_BREAKER["fails"] >= 2:
            _APIBAY_BREAKER["off_until"] = time.time() + 60
        return []
    if isinstance(data, list) and data and data[0].get("name") != "No results returned":
        for item in data:
            if isinstance(item, dict) and item.get("name"):
                item["name"] = decode_title(item["name"])
        return data
    return []


def fetch_yts(query: str) -> list:
    encoded = urllib.parse.quote(query.strip())
    url = f"{MEDIA_APIS['yts']}/api/v2/list_movies.json?query_term={encoded}&limit=20"
    data = _get(url, timeout=10, is_json=True)
    results = []
    if data.get("status") == "ok" and data.get("data", {}).get("movie_count", 0) > 0:
        for movie in data["data"]["movies"]:
            for t in movie.get("torrents", []):
                results.append({
                    "id": str(movie["id"]),
                    "name": f"{movie['title']} ({movie['year']}) {t['quality']} YTS",
                    "seeders": str(t.get("seeds", 0)),
                    "size": str(t.get("size_bytes", 0)),
                    "info_hash": t.get("hash", ""),
                })
    return results


def fetch_solidtorrents(query: str) -> list:
    encoded = urllib.parse.quote(query.strip())
    url = f"https://solidtorrents.net/api/v1/search?q={encoded}&category=video"
    try:
        data = _get(url, timeout=8, is_json=True)
    except Exception:
        return []
    results = []
    if isinstance(data, dict) and data.get("results"):
        for r in data["results"]:
            title = decode_title(r.get("title", ""))
            magnet = r.get("magnet", "")
            m = re.search(r"btih:([a-fA-F0-9]{40})", magnet)
            info_hash = m.group(1).lower() if m else r.get("infohash", "").lower()
            swarm = r.get("swarm", {}) or {}
            seeders = str(swarm.get("seeders", 0) or 0)
            size = str(r.get("size", 0) or 0)
            if title and info_hash:
                results.append({
                    "name": title,
                    "seeders": seeders,
                    "size": size,
                    "info_hash": info_hash,
                })
    return results


def _parse_size(text: str) -> int:
    m = re.search(r"([\d.]+)\s*(TB|GB|MB|KB)", text, re.I)
    if not m:
        return 0
    value = float(m.group(1))
    unit = m.group(2).upper()
    mult = {"TB": 1024 ** 4, "GB": 1024 ** 3, "MB": 1024 ** 2, "KB": 1024}.get(unit, 1)
    return int(value * mult)


# Circuit breaker for the FlareSolverr dependency. 1337x is an optional source;
# when the local FlareSolverr is down or extremely slow, a search must NOT hang
# for minutes — we flip the breaker and route 1337x fetches to return nothing.
_FS_BREAKER = {"off_until": 0.0}


def _flaresolverr_healthy() -> bool:
    if time.time() < _FS_BREAKER["off_until"]:
        return False
    fs_url = os.environ.get("FLARESOLVERR_URL", "").strip().rstrip("/")
    if not fs_url:
        return False
    try:
        req = urllib.request.Request(fs_url + "/health", headers={"User-Agent": UA})
        with urllib.request.urlopen(req, context=get_unverified_context(), timeout=2) as res:
            if res.status != 200:
                _FS_BREAKER["off_until"] = time.time() + 30
                return False
            return True
    except Exception:
        _FS_BREAKER["off_until"] = time.time() + 30
        return False


def _fetch_html_via_flaresolverr(url: str) -> str:
    """Fetch an HTML page, routing through FlareSolverr when configured and
    healthy (bypasses Cloudflare challenges on protected trackers like 1337x)."""
    fs_url = os.environ.get("FLARESOLVERR_URL", "").strip().rstrip("/")
    if not fs_url or not _flaresolverr_healthy():
        # 1337x is Cloudflare-protected. Plain fetch without FlareSolverr either
        # times out or returns 403, so return immediately to avoid blocking the search.
        return ""
    payload = json.dumps({"cmd": "request.get", "url": url, "maxTimeout": 12000}).encode()
    req = urllib.request.Request(
        fs_url + "/v1",
        data=payload,
        headers={"Content-Type": "application/json", "User-Agent": UA},
        method="POST",
    )
    with urllib.request.urlopen(req, context=get_unverified_context(), timeout=30) as res:
        data = json.loads(res.read().decode("utf-8", "replace"))
    return (data.get("solution", {}) or {}).get("response", "")


def _fetch_1337x_magnet(id_str: str) -> str:
    try:
        html = _fetch_html_via_flaresolverr(f"https://1337x.to/torrent/{id_str}/")
        m = re.search(r"magnet:\?xt=urn:btih:([a-fA-F0-9]{40})", html)
        if m:
            return f"magnet:?xt=urn:btih:{m.group(1)}"
    except Exception:
        pass
    return ""


def fetch_1337x(query: str) -> list:
    try:
        slug = urllib.parse.quote(query.strip().replace(" ", "+"))
        html = _fetch_html_via_flaresolverr(f"https://1337x.to/search/{slug}/1/")
    except Exception:
        return []
    if not html:
        return []

    rows = html.split("<tr")
    items = []
    for row in rows[1:]:
        href_m = re.search(r'href="/torrent/(\d+)/', row)
        title_m = re.search(r"<a[^>]*href=\"/torrent/\d+/[^\"]*\"[^>]*>(.*?)</a>", row)
        seeds_m = re.search(r'class="coll-2 seeds">(\d+)</td>', row)
        size_m = re.search(r'class="coll-4 size">([^<]+)</td>', row)
        if not href_m or not title_m:
            continue
        name = re.sub(r"<[^>]+>", "", title_m.group(1)).strip()
        if not name:
            continue
        items.append({
            "name": name,
            "seeders": seeds_m.group(1) if seeds_m else "0",
            "size": str(_parse_size(size_m.group(1))) if size_m else "0",
            "info_hash": "",
            "id": href_m.group(1),
        })

    if not items:
        return []

    # Fetch magnets for the top candidates (best-effort, parallel). Enrich only
    # the two strongest rows — 1337x magnets cost ~14s each via FlareSolverr
    # and the marginal return past the top row is tiny.
    def enrich(item):
        magnet = _fetch_1337x_magnet(item["id"])
        m = re.search(r"btih:([a-fA-F0-9]{40})", magnet)
        item["info_hash"] = m.group(1).lower() if m else ""
        return item

    top = items[:2]
    with ThreadPoolExecutor(max_workers=2) as ex:
        enriched = list(ex.map(enrich, top))

    return [i for i in enriched if i["info_hash"]]


def search_all(query: str) -> list:
    """Search every enabled source, merge and dedup by infohash."""
    cached = _cache_get(query)
    if cached is not None:
        return cached

    merged = {}
    fetchers = [fetch_apibay, fetch_yts, fetch_solidtorrents]
    if _ENABLE_1337X:
        fetchers.append(fetch_1337x)
    if _ENABLE_NYAA:
        from sources_nyaa import search_nyaa
        fetchers.append(search_nyaa)
    if _ENABLE_PROWLARR:
        from sources_prowlarr import search_prowlarr
        fetchers.append(search_prowlarr)

    with ThreadPoolExecutor(max_workers=len(fetchers)) as ex:
        futures = {ex.submit(f, query): f for f in fetchers}
        for fut in as_completed(futures):
            try:
                for t in fut.result():
                    h = t.get("info_hash", "")
                    if not h:
                        continue
                    cur = merged.get(h)
                    if cur is None or int(t.get("seeders", "0") or 0) > int(cur.get("seeders", "0") or 0):
                        merged[h] = t
            except Exception:
                continue

    result = list(merged.values())
    _cache_set(query, result)
    return result


from config import ENABLE_1337X as _ENABLE_1337X  # noqa: E402
from config import ENABLE_NYAA as _ENABLE_NYAA  # noqa: E402
from config import ENABLE_PROWLARR as _ENABLE_PROWLARR  # noqa: E402
