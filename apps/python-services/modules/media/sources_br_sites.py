#!/usr/bin/env python3
"""WordPress BR curated torrent fetcher for JackIn media services.

Sites como baixetorrents.net e mestredosfilmes.top publicam posts WordPress
com magnets curados manualmente — qualidade, tamanho e idioma rotulados pelo
curador. Cada página de filme tem 2-5 links (Dublado, Legendado, Original) que
o apibay/1337x nem sempre indexam (grupos BR publicam por trackers próprios).

A WordPress REST API é pública e aceita busca textual. Fluxo por site:
    1. POST /wp-json/wp/v2/search?search=<query>  ->  posts relevantes
    2. GET  HTML de cada post                      ->  extrai magnets + labels
    3. Parseia labels -> audio_type / pt_confirmed / resolution / size

Filosofia igual aos outros sources: falha em QUALQUER ponto retorna [] e o
engine simplesmente não recebe candidatos desse site. Nada bloqueia as demais.
"""
import json
import re
import html as htmlmod
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

from config import get_unverified_context, get_session

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

# Search endpoints and per-site label format.
#   label_type "inline":   label está DENTRO do <a> que carrega o magnet
#   label_type "context":  label está no texto IMEDIATAMENTE ANTES do <a>
#   label_type "buttons":  botões .btn-download (Torrent 720p/1080p) carregam o
#                          magnet; áudio e resolução vêm do corpo do post
WP_SITES = [
    {
        "name": "baixetorrents",
        "search_url": "https://www.baixetorrents.net/wp-json/wp/v2/search",
        "max_posts": 4,
        "label_type": "inline",
    },
    {
        "name": "mestredosfilmes",
        "search_url": "https://mestredosfilmes.top/wp-json/wp/v2/search",
        "max_posts": 4,
        "label_type": "context",
    },
    {
        "name": "limontorrents",
        "search_url": "https://limontorrents.site/wp-json/wp/v2/search",
        "max_posts": 4,
        "label_type": "buttons",
    },
]

# Cached WordPress search results (posts found for a query).
_CACHE = {}
_CACHE_TTL = 300


def _cache_get(key):
    item = _CACHE.get(key)
    if item and item[1] > time.time():
        return item[0]
    return None


def _cache_set(key, value):
    _CACHE[key] = (value, time.time() + _CACHE_TTL)


def _get(url, timeout=(2.0, 4.0), is_json=True):
    try:
        session = get_session()
        r = session.get(url, timeout=timeout, headers={"User-Agent": UA})
        if r.status_code != 200:
            return {} if is_json else ""
        return r.json() if is_json else r.text
    except Exception:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            to = timeout[1] if isinstance(timeout, (tuple, list)) else timeout
            with urllib.request.urlopen(req, context=get_unverified_context(), timeout=to) as res:
                body = res.read().decode("utf-8", "replace")
            return json.loads(body) if is_json else body
        except Exception:
            return {} if is_json else ""



def _parse_size(text: str) -> int:
    m = re.search(r"([\d.]+)\s*(TB|GB|MB|KB)", text, re.I)
    if not m:
        return 0
    value = float(m.group(1))
    unit = m.group(2).upper()
    mult = {"TB": 1024 ** 4, "GB": 1024 ** 3, "MB": 1024 ** 2, "KB": 1024}.get(unit, 1)
    return int(value * mult)


# ─── Label parsing ────────────────────────────────────────────────────────────

def _classify_lang(lang_raw: str):
    """Classify a language token from a label into (audio_type, pt_confirmed).

    baixetorrents style: "Dublado R5", "Inglês", "Português", "Dual Áudio".
    """
    up = lang_raw.upper()
    if "DUBLAD" in up or "PORTUG" in up or "PT-BR" in up or "PTBR" in up:
        return "dub", True
    if "DUAL" in up or "MULTI" in up:
        return "dual", False
    if "LEGENDAD" in up:
        return "legendado", False
    return "original", False


def _parse_label_bt(raw: str) -> dict:
    """Parse a baixetorrents label: '🧲 1080p | 3.96 GB | Dublado R5'."""
    parts = [p.strip() for p in raw.split("|")]
    quality_raw = parts[0] if len(parts) > 0 else ""
    size_raw = parts[1] if len(parts) > 1 else ""
    lang_raw = parts[2] if len(parts) > 2 else ""

    resolution = None
    m = re.search(r"(2160p|4K|1080p|720p|480p)", quality_raw, re.I)
    if m:
        resolution = m.group(1).upper()

    audio_type, pt_confirmed = _classify_lang(lang_raw)
    return {
        "resolution": resolution,
        "size_bytes": _parse_size(size_raw),
        "audio_type": audio_type,
        "pt_confirmed": pt_confirmed,
    }


def _parse_label_mestre(raw: str) -> dict:
    """Parse a mestredosfilmes context label.

    Exemplos reais do HTML (após remover tags/atributos):
      'DUAL ÁUDIO / DUBLADO :: WEB-DL IMAX 1080p Dual Áudio 5.1 (MKV)'
      ':: LEGENDADO :: BluRay 1080p (MP4) | 2.52 GB'
      'BluRay 1080p Dual Áudio 5.1 FULL HD (MKV)'
    """
    up = raw.upper()
    if "DUBLAD" in up:
        audio_type, pt_confirmed = "dub", True
    elif "DUAL" in up or "MULTI" in up:
        audio_type, pt_confirmed = "dual", False
    elif "LEGENDAD" in up:
        audio_type, pt_confirmed = "legendado", False
    else:
        audio_type, pt_confirmed = "original", False

    resolution = None
    m = re.search(r"((?:2160p|4K|1080p|720p|480p))", up, re.I)
    if m:
        resolution = m.group(1).upper()

    return {
        "resolution": resolution,
        "size_bytes": _parse_size(raw),
        "audio_type": audio_type,
        "pt_confirmed": pt_confirmed,
    }


# ─── limontorrents (label_type "buttons") ─────────────────────────────────────

_AUDIO_META_RE = re.compile(r"Áudio:\s*([^<>\n]{2,40})", re.I)
_SIZE_META_RE = re.compile(r"Tamanho:\s*([\d.,]+\s*(?:GB|MB|TB))", re.I)


def _parse_size_bytes(raw: str) -> int:
    """Parse '2.5 GB' / '750 MB' into integer bytes."""
    m = re.search(r"([\d.,]+)\s*(GB|MB|TB)", raw, re.I)
    if not m:
        return 0
    num = float(m.group(1).replace(",", "."))
    unit = m.group(2).upper()
    if unit == "TB":
        return int(num * 1024 ** 4)
    if unit == "GB":
        return int(num * 1024 ** 3)
    return int(num * 1024 ** 2)


def _parse_label_limon(raw: str) -> dict:
    """Parse a limontorrents label. Labels are plain quality buttons
    ("Torrent 720p"), so audio info comes from the post body ("Áudio: Dual
    Áudio") or defaults to the site's standard dual-audio PT release."""
    up = raw.upper()
    if "DUAL" in up or "MULTI" in up:
        audio_type, pt_confirmed = "dual", False
    elif "DUBLAD" in up:
        audio_type, pt_confirmed = "dub", True
    elif "LEGENDAD" in up:
        audio_type, pt_confirmed = "legendado", False
    else:
        audio_type, pt_confirmed = "original", False

    resolution = None
    m = re.search(r"((?:2160p|4K|1080p|720p|480p))", up, re.I)
    if m:
        resolution = m.group(1).upper()

    return {
        "resolution": resolution,
        "size_bytes": 0,
        "audio_type": audio_type,
        "pt_confirmed": pt_confirmed,
    }


def _extract_buttons(html: str) -> list:
    """limontorrents: <a href="magnet:..." class="btn-download green"> Torrent 720p</a>.

    The label sits on the line AFTER the opening <a>, so the capture uses DOTALL
    and trims whitespace. The same magnet is usually offered as multiple quality
    buttons; the caller dedups by infohash keeping the best (highest) quality.
    """
    out = []
    for m in re.finditer(
        r'<a[^>]+href="(magnet:[^"]+)"[^>]*class="[^"]*btn-download[^"]*"[^>]*>\s*([^<]{1,40})',
        html,
        re.S | re.I,
    ):
        href = m.group(1)
        hm = re.search(r"btih[:%]([a-fA-F0-9]{40})", href)
        if not hm:
            continue
        label = m.group(2).strip()
        out.append({
            "info_hash": hm.group(1).lower(),
            "url": href,
            "label": label,
        })
    return out


# ─── Magnet extraction ────────────────────────────────────────────────────────

def _extract_inline(html: str) -> list:
    """baixetorrents: <a href="magnet:...">🧲 1080p | 3.96 GB | Dublado R5</a>."""
    out = []
    for href, label in re.findall(r'<a[^>]+href="(magnet:[^"]+)"[^>]*>(.*?)</a>', html):
        m = re.search(r"btih[:%]([a-fA-F0-9]{40})", href)
        if not m:
            continue
        label_txt = re.sub(r"<[^>]+>", "", label)
        label_txt = htmlmod.unescape(label_txt).strip()
        out.append({
            "info_hash": m.group(1).lower(),
            "url": href.replace("&amp;", "&"),
            "label": label_txt,
        })
    return out


def _extract_context(html: str) -> list:
    """mestredosfilmes: '...Versão Dublado 720p (MP4) <a href="magnet:...">'."""
    out = []
    for m in re.finditer(r"magnet:\?xt=urn:btih:([a-fA-F0-9]{40})", html):
        start = max(0, m.start() - 200)
        ctx = html[start:m.start()]
        ctx = re.sub(r"<[^>]+>", " ", ctx)
        ctx = re.sub(r"\s+", " ", ctx).strip()
        # O label útil é a última frase antes do magnet (ex: "Versão Dublado 720p").
        tail = ctx[-90:] if ctx else ""
        out.append({
            "info_hash": m.group(1).lower(),
            "url": "magnet:?xt=urn:btih:" + m.group(1),
            "label": tail,
        })
    return out


def _extract_magnets(html: str, label_type: str) -> list:
    if label_type == "inline":
        return _extract_inline(html)
    if label_type == "buttons":
        return _extract_buttons(html)
    return _extract_context(html)


# ─── Per-site search ──────────────────────────────────────────────────────────

def _fetch_post_magnets(post_url: str, site: dict) -> list:
    try:
        html = _get(post_url, timeout=(2.0, 3.5), is_json=False)
    except Exception:
        return []
    if not html:
        return []

    items = _extract_magnets(html, site["label_type"])
    out = []
    page_title = _post_title(html)
    for it in items:
        if not it["info_hash"]:
            continue
        label = it["label"] or ""
        # Remove emojis do label.
        label = re.sub(r"[\U0001F300-\U0001FAFF\u2600-\u27BF]", "", label).strip()

        if site["label_type"] == "inline":
            parsed = _parse_label_bt(label)
        elif site["label_type"] == "buttons":
            # limontorrents: label is only "Torrent 720p"; audio comes from the
            # post body ("Áudio: Dual Áudio") or defaults to the site standard.
            parsed = _parse_label_limon(label)
            body_audio = _AUDIO_META_RE.search(html)
            if body_audio:
                body_parsed = _parse_label_limon(body_audio.group(1))
                if body_parsed["audio_type"] != "original":
                    parsed = body_parsed
                    if parsed["resolution"] is None:
                        parsed["resolution"] = _parse_label_limon(label)["resolution"]
            elif parsed["audio_type"] == "original":
                # Site-wide standard: releases are Dual Áudio (EN+PT).
                parsed["audio_type"] = "dual"
            # Extract file size from the post body ("Tamanho: 2.5 GB").
            size_match = _SIZE_META_RE.search(html)
            if size_match:
                parsed["size_bytes"] = _parse_size_bytes(size_match.group(1))
            elif parsed["resolution"]:
                # Fallback: reasonable defaults per quality tier.
                defaults = {"2160P": 25_000_000_000, "4K": 25_000_000_000,
                            "1080P": 4_000_000_000, "720P": 2_000_000_000,
                            "480P": 1_200_000_000}
                parsed["size_bytes"] = defaults.get(parsed["resolution"], 4_000_000_000)
        else:
            parsed = _parse_label_mestre(label)
            # O contexto às vezes não carrega o idioma; o título da página
            # ("...Dual Áudio 5.1 / Dublado") é um fallback confiável.
            if parsed["audio_type"] == "original" and page_title:
                pt = _parse_label_mestre(page_title)
                if pt["pt_confirmed"] or pt["audio_type"] in ("dual", "legendado"):
                    parsed = pt

        prefixes = []
        if parsed["pt_confirmed"]:
            prefixes.append("Dublado")
        elif parsed["audio_type"] == "dual":
            prefixes.append("Dual Áudio")
        elif parsed["audio_type"] == "legendado":
            prefixes.append("Legendado")

        base_title = page_title or htmlmod.unescape(it["label"] or "")
        # Site name suffix from og:title (e.g. "Piratas ... (2003) Limontorrents.")
        base_title = re.sub(r"\s*[–-]?\s*limontorrents\.?\s*$", "", base_title, flags=re.I).strip()
        name = f"[{' '.join(prefixes)}] {base_title}".strip()
        if parsed["resolution"]:
            name += f" {parsed['resolution']}"
        if parsed["size_bytes"]:
            name += f" {parsed['size_bytes'] / (1024 ** 3):.1f}GB"

        out.append({
            "name": f"{name} - {site['name']}",
            "seeders": "30",
            "size": str(parsed["size_bytes"] or 0),
            "info_hash": it["info_hash"],
        })

    # Buttons: the same magnet may appear as 720p and 1080p; keep the highest
    # resolution (so the dedup merge keeps the best quality).
    if site["label_type"] == "buttons":
        _RES_ORDER = {"4K": 4, "2160P": 4, "1080P": 3, "720P": 2, "480P": 1, None: 0}
        _RES_RE = re.compile(r"\b(4K|2160P|1080P|720P|480P)\b", re.I)
        def _res_rank(t):
            m = _RES_RE.search(t["name"])
            return _RES_ORDER.get(m.group(1).upper() if m else None, 0)
        out.sort(key=_res_rank, reverse=True)
    return out


def _post_title(html: str) -> str:
    # og:title é o título limpo do curador (ex: "Shang-Chi e a Lenda dos Dez
    # Anéis [IMAX] Torrent (2021) Dual Áudio 5.1 / Dublado"). Falls back to
    # <title> (que carrega o nome do site).
    m = re.search(r'<meta[^>]+property="og:title"[^>]+content="([^"]+)"', html, re.I)
    if not m:
        m = re.search(r"<title>(.*?)</title>", html, re.S | re.I)
    if m:
        return re.sub(r"\s+", " ", htmlmod.unescape(m.group(1))).strip()
    return ""


def _search_site(site: dict, query: str) -> list:
    key = f"wp:{site['name']}:{query.strip().lower()}"
    cached = _cache_get(key)
    if cached is not None:
        return cached

    params = urllib.parse.urlencode({"search": query, "per_page": site["max_posts"]})
    url = f"{site['search_url']}?{params}"
    try:
        # _get com is_json=True (default) já faz json.loads → retorna list/dict.
        data = _get(url, timeout=(2.0, 3.5))
    except Exception:
        return []


    if not isinstance(data, list):
        return []

    posts = [p.get("url") for p in data if p.get("url")]
    posts = posts[: site["max_posts"]]

    if not posts:
        _cache_set(key, [])
        return []

    results = []
    with ThreadPoolExecutor(max_workers=min(len(posts), 6)) as ex:
        futures = [ex.submit(_fetch_post_magnets, u, site) for u in posts]
        for fut in as_completed(futures):
            try:
                results.extend(fut.result())
            except Exception:
                continue

    _cache_set(key, results)
    return results


# ─── Public API ───────────────────────────────────────────────────────────────

def search_wp_sites(query: str) -> list:
    """Search all WordPress BR sites in parallel, merge and dedup by infohash."""
    if not query or not query.strip():
        return []

    merged = {}
    with ThreadPoolExecutor(max_workers=len(WP_SITES)) as ex:
        futures = {ex.submit(_search_site, site, query): site for site in WP_SITES}
        for fut in as_completed(futures):
            try:
                for it in fut.result():
                    h = it.get("info_hash", "")
                    if not h:
                        continue
                    cur = merged.get(h)
                    if cur is None or int(it.get("seeders", "0") or 0) > int(cur.get("seeders", "0") or 0):
                        merged[h] = it
            except Exception:
                continue

    return list(merged.values())


if __name__ == "__main__":
    import sys as _sys
    q = _sys.argv[1] if len(_sys.argv) > 1 else "vingadores ultimato"
    for r in search_wp_sites(q):
        print(f"[{r['seeders']}] {r['name'][:80]}  -> {r['info_hash'][:16]}...")
