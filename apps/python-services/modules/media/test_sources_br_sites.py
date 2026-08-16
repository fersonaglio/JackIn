#!/usr/bin/env python3
"""Unit tests for the WordPress BR curated source (sources_br_sites.py).

No network required — mocks _get and exercises label parsing + magnet
extraction + per-site search flow.
Run: python3 test_sources_br_sites.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import sources_br_sites as s

FAILURES = []


def check(name, cond):
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {name}")
    if not cond:
        FAILURES.append(name)


# ─── Label parsing ────────────────────────────────────────────────────────────

def test_parse_label_bt():
    d = s._parse_label_bt("🧲 1080p | 3.96 GB | Dublado R5")
    check("bt dublado → dub", d["audio_type"] == "dub")
    check("bt dublado → ptConfirmed", d["pt_confirmed"] is True)
    check("bt dublado → resolution 1080p", d["resolution"] == "1080P")
    check("bt dublado → size parsed", d["size_bytes"] == int(3.96 * 1024**3))

    d2 = s._parse_label_bt("🧲 1080p | 2.44 GB | Inglês")
    check("bt inglês → original", d2["audio_type"] == "original")
    check("bt inglês → !ptConfirmed", d2["pt_confirmed"] is False)

    d3 = s._parse_label_bt("🧲 2160p | 5.89 GB | Inglês")
    check("bt 2160p → resolution", d3["resolution"] == "2160P")


def test_parse_label_mestre():
    d = s._parse_label_mestre("DUAL ÁUDIO / DUBLADO :: WEB-DL IMAX 1080p Dual Áudio 5.1 (MKV)")
    check("mestre dublado → dub", d["audio_type"] == "dub")
    check("mestre dublado → ptConfirmed", d["pt_confirmed"] is True)

    d2 = s._parse_label_mestre(":: LEGENDADO :: BluRay 1080p (MP4) | 2.52 GB")
    check("mestre legendado → legendado", d2["audio_type"] == "legendado")
    check("mestre legendado → !ptConfirmed", d2["pt_confirmed"] is False)

    d3 = s._parse_label_mestre("BluRay 1080p Dual Áudio 5.1 FULL HD (MKV)")
    check("mestre dual → dual", d3["audio_type"] == "dual")


# ─── Magnet extraction ────────────────────────────────────────────────────────

def test_extract_inline():
    html = '<a href="magnet:?xt=urn:btih:418bcfaa3cb259522152dfe21a428de3f75f276b&amp;tr=x">🧲 1080p | 3.96 GB | Dublado R5</a>'
    items = s._extract_inline(html)
    check("inline finds magnet", len(items) == 1)
    check("inline hash lowercase", items[0]["info_hash"] == "418bcfaa3cb259522152dfe21a428de3f75f276b")
    check("inline label kept", "Dublado R5" in items[0]["label"])


def test_extract_context():
    html = 'Versão Dublado 1080p (MP4) <a href="magnet:?xt=urn:btih:e9dc782fd74dc47624050d8ccb82b904b6ae55a3">x</a>'
    items = s._extract_context(html)
    check("context finds magnet", len(items) == 1)
    check("context label captured", "Dublado" in items[0]["label"])


def test_parse_label_limon():
    d = s._parse_label_limon("Torrent 1080p")
    check("limon label resolution", d["resolution"] == "1080P")
    check("limon label no audio → original", d["audio_type"] == "original")
    d2 = s._parse_label_limon("Dual Áudio")
    check("limon audio dual", d2["audio_type"] == "dual")
    d3 = s._parse_label_limon("Dublado")
    check("limon dublado ptConfirmed", d3["pt_confirmed"] is True)


def test_extract_buttons():
    html = (
        '<div class="download-buttons">'
        '<a href="magnet:?xt=urn:btih:2782e7c161c25f4ffa5eb7afa92c488dbd29a65d" class="btn-download green">\n'
        '  Torrent 720p\n</a>'
        '<a href="magnet:?xt=urn:btih:2782e7c161c25f4ffa5eb7afa92c488dbd29a65d" class="btn-download blue">\n'
        '  Torrent 1080p\n</a>'
        '</div>'
    )
    items = s._extract_buttons(html)
    check("buttons finds both magnets", len(items) == 2)
    check("buttons hash parsed", items[0]["info_hash"] == "2782e7c161c25f4ffa5eb7afa92c488dbd29a65d")
    check("buttons label text", items[0]["label"] == "Torrent 720p" and items[1]["label"] == "Torrent 1080p")


def test_limon_site_mocked():
    """Limontorrents posts inject the magnet via theme buttons (not in the WP
    content), so the HTML page must be parsed for .btn-download links."""
    orig_get = s._get
    html = (
        '<html><head>'
        '<meta property="og:title" content="Piratas do Caribe: A Maldição do Pérola Negra (2003) Limontorrents.">'
        '</head><body>'
        '<p>Áudio: Dual Áudio</p>'
        '<a href="magnet:?xt=urn:btih:2782e7c161c25f4ffa5eb7afa92c488dbd29a65d" class="btn-download green">\n  Torrent 1080p\n</a>'
        '</body></html>'
    )

    def fake_get(url, timeout=15, is_json=True):
        if is_json:
            return [{"title": "Piratas do Caribe: A Maldição do Pérola Negra (2003)", "url": "http://x/post-1"}]
        return html

    s._get = fake_get
    try:
        s._CACHE.clear()
        limon = next(site for site in s.WP_SITES if site["name"] == "limontorrents")
        res = s._search_site(limon, "piratas do caribe")
        check("limon search returns item", len(res) == 1)
        if res:
            r = res[0]
            check("limon hash parsed", r["info_hash"] == "2782e7c161c25f4ffa5eb7afa92c488dbd29a65d")
            check("limon seeds boosted", r["seeders"] == "30")
            check("limon dual audio", "Dual Áudio" in r["name"])
            check("limon resolution", "1080P" in r["name"])
            check("limon site suffix", r["name"].endswith("- limontorrents"))
            check("limon site name stripped from title", "Limontorrents." not in r["name"])
    finally:
        s._get = orig_get
        s._CACHE.clear()


# ─── Per-site search with mocked HTTP ────────────────────────────────────────

def test_search_site_mocked():
    orig_get = s._get
    html = ('<html><head><title>Shang-Chi e a Lenda dos Dez Anéis | Baixe Torrent</title></head>'
            '<body><a href="magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&amp;tr=x">🧲 1080p | 3.96 GB | Dublado R5</a></body></html>')

    def fake_get(url, timeout=15, is_json=True):
        if is_json:
            return [{"title": "Shang-Chi e a Lenda dos Dez Anéis", "url": "http://x/post-1"}]
        return html

    s._get = fake_get
    try:
        s._CACHE.clear()
        res = s._search_site(s.WP_SITES[0], "shang chi")
        check("search_site returns items", len(res) >= 1)
        if res:
            check("item has 40-char hash", len(res[0]["info_hash"]) == 40)
            check("item name marks Dublado", "Dublado" in res[0]["name"])
            check("item source site", res[0]["name"].endswith("- baixetorrents"))
    finally:
        s._get = orig_get
        s._CACHE.clear()


def test_dedup_by_infohash():
    orig_get = s._get
    html = '<a href="magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&amp;tr=x">🧲 1080p | 3.96 GB | Dublado R5</a>'

    def fake_get(url, timeout=15, is_json=True):
        if is_json:
            return [{"title": "X", "url": "http://x/1"}, {"title": "X2", "url": "http://x/2"}]
        return html

    s._get = fake_get
    try:
        s._CACHE.clear()
        res = s.search_wp_sites("x")
        check("wp search dedups by hash", len(res) == 1)
    finally:
        s._get = orig_get
        s._CACHE.clear()


def test_failure_returns_empty():
    orig_get = s._get

    def boom(url, timeout=15, is_json=True):
        raise RuntimeError("network down")

    s._get = boom
    try:
        s._CACHE.clear()
        res = s.search_wp_sites("qualquer coisa")
        check("network failure → []", res == [])
    finally:
        s._get = orig_get
        s._CACHE.clear()


# ─── Runner ───────────────────────────────────────────────────────────────────

test_parse_label_bt()
test_parse_label_mestre()
test_parse_label_limon()
test_extract_inline()
test_extract_context()
test_extract_buttons()
test_search_site_mocked()
test_limon_site_mocked()
test_dedup_by_infohash()
test_failure_returns_empty()

print()
if FAILURES:
    print(f"RESULTADO: {len(FAILURES)} FALHAS -> {FAILURES}")
    sys.exit(1)
print("RESULTADO: TODOS OS TESTES PASSARAM ✅")
