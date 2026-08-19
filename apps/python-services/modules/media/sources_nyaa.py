#!/usr/bin/env python3
"""Nyaa torrent fetcher for JackIn media services.

Best-effort RSS fetcher for https://nyaa.si. Returns a list of
`{name, seeders, size, info_hash}` dicts. On any network/parse error it
returns [] so callers can merge it with other sources safely.
"""
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

from config import get_unverified_context, get_session

NS = "{https://nyaa.si/xmlns/nyaa}"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
RSS_URL = "https://nyaa.si/?page=rss&q={query}&c=0_0"
TIMEOUT = (2.0, 3.5)
MIN_RESULTS = 3

_SIZE_MULT = {"TIB": 1024 ** 4, "GIB": 1024 ** 3, "MIB": 1024 ** 2, "KIB": 1024}
_HASH_RE = re.compile(r"^[a-f0-9]{40}$")


def parse_size(text):
    """Parse a Nyaa size like '1.2 GiB' / '500 MiB' into integer bytes."""
    m = re.search(r"([\d.]+)\s*(TiB|GiB|MiB|KiB)", text or "", re.I)
    if not m:
        return 0
    return int(float(m.group(1)) * _SIZE_MULT[m.group(2).upper()])


def _item_text(item, tag, default=""):
    el = item.find(NS + tag)
    if el is not None and el.text:
        return el.text.strip()
    return default


def parse_rss(xml_str):
    """Parse a Nyaa RSS feed into torrent dicts. Network-free."""
    results = []
    try:
        root = ET.fromstring(xml_str)
    except ET.ParseError:
        return []
    for item in root.iter("item"):
        info_hash = _item_text(item, "infoHash").lower()
        if not _HASH_RE.match(info_hash):
            continue
        title = item.find("title")
        name = title.text.strip() if title is not None and title.text else ""
        if not name:
            continue
        results.append({
            "name": name,
            "seeders": _item_text(item, "seeders", "0") or "0",
            "size": str(parse_size(_item_text(item, "size"))),
            "info_hash": info_hash,
        })
    return results


def _merge(results):
    """Merge a list of torrent dicts, dedup by info_hash (keep most seeders)."""
    merged = {}
    for t in results:
        h = t.get("info_hash", "")
        if not h:
            continue
        cur = merged.get(h)
        if cur is None or int(t.get("seeders", "0") or 0) > int(cur.get("seeders", "0") or 0):
            merged[h] = t
    return list(merged.values())


def _fetch_rss(query):
    url = RSS_URL.format(query=urllib.parse.quote(query.strip()))
    try:
        session = get_session()
        r = session.get(url, timeout=TIMEOUT, headers={"User-Agent": UA})
        if r.status_code == 200:
            return r.text
    except Exception:
        pass
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, context=get_unverified_context(), timeout=3.5) as res:
            return res.read().decode("utf-8", "replace")
    except Exception:
        return ""


def search_nyaa(query):
    """Search Nyaa RSS for torrents matching query."""
    try:
        results = parse_rss(_fetch_rss(query))
        if len(results) < MIN_RESULTS:
            results += parse_rss(_fetch_rss(f"{query} DUBLADO"))
            results += parse_rss(_fetch_rss(f"{query} LEGENDADO"))
        return _merge(results)
    except Exception:
        return []

