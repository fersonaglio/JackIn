#!/usr/bin/env python3
"""Brazilian-focused torrent fetcher for JackIn media services.

PT-BR releases rarely appear under a plain English title query — they carry
tags like "DUBLADO", "DUAL AUDIO", "LEGENDADO" or "PT-BR". This module runs
tagged hunts against the sources that actually host Brazilian content
(apibay is the primary one; 1337x via FlareSolverr when available) and merges
them. Any source failure returns [] so callers merge safely.
"""
import json
import os
import re
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

from config import MEDIA_APIS, get_unverified_context, get_session
from matcher import similarity
from normalize import is_series, series_base_title, normalize_key as _norm_key
from sources import _fetch_html_via_flaresolverr, decode_title, fetch_solidtorrents

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

# Tags that surface Brazilian releases on the sources below.
PT_TAGS = ("DUBLADO", "DUAL AUDIO", "DUAL", "LEGENDADO", "PT-BR")

# Similarity floor for short-title hunts (fewer than 3 distinctive tokens).
_SHORT_SIM_MIN = 0.45

# Franchise heads whose bare mention is ambiguous ("Star Wars" matches every
# entry in the saga). When the title's anchor token is one of these, a release
# must ALSO carry a tail (non-head) token so the correct film is picked.
_FRANCHISE_ANCHORS = {
    "star", "wars", "starwars", "harry", "potter", "lord", "rings",
    "jurassic", "avengers", "marvel", "dc", "fast", "furious",
    "mission", "impossible", "pirates", "trek", "spiderman", "spider",
    "batman", "superman", "matrix", "terminator", "aliens", "predator",
    "xmen", "indiana", "jones", "transformers", "ghostbusters",
    "planet", "apes", "toy", "story", "shrek", "minions",
}

_CACHE = {}
_CACHE_TTL = 300  # seconds


def _cache_get(key):
    item = _CACHE.get(key)
    if item and item[1] > time.time():
        return item[0]
    return None


def _cache_set(key, value):
    _CACHE[key] = (value, time.time() + _CACHE_TTL)


_APIBAY_BREAKER = {"fails": 0, "off_until": 0.0}


def _apibay(query: str) -> list:
    if time.time() < _APIBAY_BREAKER["off_until"]:
        return []
    encoded = urllib.parse.quote(query.strip().lower())
    url = f"{MEDIA_APIS['apibay']}/q.php?q={encoded}"
    data = None
    try:
        session = get_session()
        r = session.get(url, timeout=(2.0, 3.0), headers={"User-Agent": UA})
        if r.status_code == 200:
            data = r.json()
            _APIBAY_BREAKER["fails"] = 0
    except Exception:
        pass
    if data is None:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, context=get_unverified_context(), timeout=2.5) as res:
                data = json.loads(res.read().decode("utf-8", "replace"))
                _APIBAY_BREAKER["fails"] = 0
        except Exception:
            _APIBAY_BREAKER["fails"] += 1
            if _APIBAY_BREAKER["fails"] >= 2:
                _APIBAY_BREAKER["off_until"] = time.time() + 60
            return []
    if not isinstance(data, list) or not data or data[0].get("name") == "No results returned":
        return []
    for item in data:
        if isinstance(item, dict) and item.get("name"):
            item["name"] = decode_title(item["name"])
    return data



def _parse_size(text: str) -> int:
    m = re.search(r"([\d.]+)\s*(TB|GB|MB|KB)", text or "", re.I)
    if not m:
        return 0
    value = float(m.group(1))
    unit = m.group(2).upper()
    mult = {"TB": 1024 ** 4, "GB": 1024 ** 3, "MB": 1024 ** 2, "KB": 1024}.get(unit, 1)
    return int(value * mult)


def _search_1337x_torrent(query: str) -> list:
    """Search 1337x for a tagged PT query, returning rows with id + name."""
    slug = urllib.parse.quote(query.strip().replace(" ", "+"))
    html = _fetch_html_via_flaresolverr(f"https://1337x.to/search/{slug}/1/")
    if not html or "coll-2 seeds" not in html:
        return []
    items = []
    for row in html.split("<tr")[1:]:
        path_m = re.search(r'href="/torrent/([0-9]+/[^"]*)"', row)
        title_m = re.search(r'<a[^>]*href="/torrent/[0-9]+/[^"]*"[^>]*>(.*?)</a>', row)
        seeds_m = re.search(r'class="coll-2 seeds">(\d+)</td>', row)
        size_m = re.search(r'class="coll-4 size">([^<]+)</td>', row)
        if not path_m or not title_m:
            continue
        name = re.sub(r"<[^>]+>", "", title_m.group(1)).strip()
        if not name:
            continue
        items.append({
            "name": name,
            "seeders": seeds_m.group(1) if seeds_m else "0",
            "size": str(_parse_size(size_m.group(1))) if size_m else "0",
            "info_hash": "",
            "path": path_m.group(1).rstrip("/"),
        })
    return items


def _fetch_1337x_magnet(path: str) -> str:
    html = _fetch_html_via_flaresolverr(f"https://1337x.to/torrent/{path}/")
    m = re.search(r"magnet:\?xt=urn:btih:([a-fA-F0-9]{40})", html or "")
    if m:
        return f"magnet:?xt=urn:btih:{m.group(1)}"
    return ""


def _hunt_1337x(query: str) -> list:
    items = _search_1337x_torrent(query)
    if not items:
        return []
    top = items[:2]

    def enrich(item):
        magnet = _fetch_1337x_magnet(item["path"])
        m = re.search(r"btih:([a-fA-F0-9]{40})", magnet)
        item["info_hash"] = m.group(1).lower() if m else ""
        return item

    with ThreadPoolExecutor(max_workers=2) as ex:
        enriched = list(ex.map(enrich, top))
    return [i for i in enriched if i["info_hash"]]


def _dedupe(items: list) -> list:
    merged = {}
    for t in items:
        h = t.get("info_hash", "")
        if not h:
            continue
        cur = merged.get(h)
        if cur is None or int(t.get("seeders", "0") or 0) > int(cur.get("seeders", "0") or 0):
            merged[h] = t
    return list(merged.values())


# Stop words skipped when building short query variants (order preserved).
_SHORT_STOP = {"the", "a", "an", "and", "of", "in", "on", "at", "to", "for", "with",
               "o", "os", "a", "as", "um", "uma", "do", "dos", "da", "das", "de", "em", "no", "nos", "na", "nas"}


def short_title_variants(title: str) -> list:
    """Generate compact search variants for a title.

    Brazilian releases often drop long subtitles and keep only the distinctive
    head ("Shang-Chi e a Lenda dos Dez Aneis" lives under "shang-chi" /
    "shang chi" on apibay), so a full "shang chi and the legend of the ten
    rings DUBLADO" query returns nothing. We emit:
      - the full title
      - the part before a subtitle separator (":", " - ", "- ")
      - 2-3 word prefixes (stop words skipped)
      - the hyphenated head ("shang chi" -> "shang-chi")
    Each stays a prefix of the original, so relevance filtering still works.
    """
    base = " ".join(title.split())
    variants = [base]
    lowered = base.lower()

    # Cut at subtitle separators: "Shang-Chi and the Legend of the Ten Rings"
    # -> "shang-chi and the legend of the ten rings" ... then fall through to
    # the prefix logic which trims trailing words.
    for sep in (":", " - ", "- "):
        if sep in base:
            head = base.split(sep)[0].strip()
            if head:
                variants.append(head)
            break

    # 2-3 word prefixes, skipping stop words.
    tokens = []
    for tok in re.split(r"[\s\-]+", lowered):
        tok = tok.strip(":;,.()[]")
        if tok and tok not in _SHORT_STOP:
            tokens.append(tok)
    if len(tokens) > 2:
        variants.append(" ".join(tokens[:2]))
        # Distinctive tail for long franchise titles: "star wars mandalorian
        # grogu" -> "mandalorian grogu" (the head alone is franchise noise).
        if len(tokens) >= 4:
            variants.append(" ".join(tokens[-2:]))
    if len(tokens) > 3:
        variants.append(" ".join(tokens[:3]))
    # Hyphenated head for multi-word names: "shang chi" -> "shang-chi".
    if len(tokens) >= 2:
        variants.append("-".join(tokens[:2]))
    # Hyphenated distinctive tail too: "mandalorian grogu" -> "mandalorian-grogu".
    if len(tokens) >= 4:
        variants.append("-".join(tokens[-2:]))

    seen = set()
    out = []
    for v in variants:
        v = " ".join(v.split())
        k = v.lower()
        if k and k not in seen:
            seen.add(k)
            out.append(v)
    return out


def search_pt(title: str) -> list:
    """Hunt PT-BR tagged releases for a title across apibay + 1337x.

    apibay is the dominant Brazilian source: every (variant, tag) hunt runs in
    parallel and returns in ~0.1s. The 1337x path goes through FlareSolverr
    (tens of seconds per call), so it is fired once — on the primary variant
    with the DUBLADO tag only — in the same parallel pool. Any 1337x slowness
    never blocks the result, which still returns as soon as apibay finishes.
    """
    cache_key = "pt:" + title.strip().lower()
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    base = " ".join(title.split())
    if not base:
        return []

    variants = short_title_variants(base)
    if is_series(base):
        base_title = series_base_title(base)
        if base_title and base_title not in variants:
            variants.append(base_title)

    jobs = []
    for variant in variants:
        for tag in ("DUBLADO", "DUAL", "LEGENDADO"):
            jobs.append((_apibay, f"{variant} {tag}"))
    for variant in variants[:2]:
        for tag in ("DUBLADO", "PT-BR"):
            jobs.append((fetch_solidtorrents, f"{variant} {tag}"))

    # Collect (variant, item) so the short-variant filter below can distinguish
    # results that matched the full title from franchise noise ("Star Wars").
    sourced = []
    with ThreadPoolExecutor(max_workers=min(len(jobs), 10)) as ex:
        futures = {ex.submit(fn, q): q.split(" ")[0].lower() for fn, q in jobs}
        for fut in as_completed(futures):
            variant_key = futures[fut]
            try:
                for it in fut.result():
                    it["_variant"] = variant_key
                    sourced.append(it)
            except Exception:
                continue

    # One optional 1337x hunt (slow FlareSolverr path) on the primary variant
    # only when FlareSolverr is configured and healthy.
    from sources import _flaresolverr_healthy
    if _flaresolverr_healthy():
        def hunt_1337x_bounded():
            return _hunt_1337x(f"{variants[0]} {PT_TAGS[0]}")

        with ThreadPoolExecutor(max_workers=1) as ex:
            fut = ex.submit(hunt_1337x_bounded)
            try:
                for it in fut.result(timeout=10):
                    it["_variant"] = variants[0].lower()
                    sourced.append(it)
            except Exception:
                fut.cancel()

    result = _dedupe(sourced)
    # Short variants ("Star Wars", "star-wars") surface the whole franchise.
    # Filter by distinctive token: a release must carry at least one token of
    # the requested title that is NOT a generic franchise head. Tokens that
    # appear across many unrelated franchise rows ("star", "wars") are dropped
    # from the requirement; the remaining ones ("mandalorian", "grogu") must
    # show up in the release. For a small pool we fall back to the plain
    # similarity floor so short PT titles ("Shang-Chi e a Lenda dos Dez Aneis")
    # are still kept.
    full_key = _norm_key(base)
    tokens = [t for t in full_key.split() if t not in _SHORT_STOP]
    n = max(1, len(result))
    if tokens and n >= 3:
        counts = {}
        for t in result:
            nk = _norm_key(t.get("name", ""))
            for tok in tokens:
                if tok in nk:
                    counts[tok] = counts.get(tok, 0) + 1
        # Tokens that appear in more than 70% of candidates are franchise head
        # words ("star", "wars") and do not identify the specific film. The
        # anchor token (first significant word) survives PT translation when it
        # is a proper noun ("Shang-Chi e a Lenda..." keeps "shang"), so an
        # anchor that is NOT a known ambiguous franchise head is enough on its
        # own. For ambiguous franchise anchors ("star wars") the release must
        # also carry a distinctive tail token ("mandalorian", "grogu").
        counts = {}
        for t in result:
            nk = _norm_key(t.get("name", ""))
            for tok in tokens:
                if tok in nk:
                    counts[tok] = counts.get(tok, 0) + 1
        common = {tok for tok in tokens if counts.get(tok, 0) > n * 0.7}
        distinctive = [tok for tok in tokens if tok not in common]
        # Numeric tokens ("2", "3") survive PT translation and always identify
        # the specific installment — require them regardless of franchise rule.
        numeric = [tok for tok in tokens if re.fullmatch(r"\d+", tok)]
        anchor = tokens[0]
        # For a franchise query ("Star Wars: The Mandalorian and Grogu"), the
        # first token is the franchise head ("star"), which must NOT gate a PT
        # release — the work-specific tokens ("mandalorian", "grogu") do.
        work_tokens = distinctive or tokens
        # Proper-noun tokens survive PT translation ("shang-chi" stays "shang",
        # "mandalorian" stays "mandalorian") while dictionary words translate
        # away ("legend" -> "lenda", "rings" -> "aneis"). Exclude franchise
        # heads and common words from the PT-identity check so a dubbed release
        # with the translated title is still recognized.
        _COMMON_EN = {"the", "and", "of", "a", "an", "legend", "ten", "rings", "ring", "wars", "war", "force", "dark", "dead", "world", "night", "days", "day", "man", "men", "boy", "girl", "last", "first", "best", "new", "old", "return", "rise", "fallen", "end", "begin", "part", "chapter", "tale", "saga", "furious", "fast", "from", "with", "into", "their", "his", "her"}
        # Use the FULL token set (not just "distinctive"): for a clean pool where
        # every candidate is the same film (all Shang-Chi), "shang"/"chi" become
        # "common" and would be dropped — but those proper nouns survive PT
        # translation and are exactly what identifies the dubbed release.
        pt_work_tokens = [
            w for w in tokens
            if w not in _FRANCHISE_ANCHORS and w not in _COMMON_EN
        ] or tokens

        # A release that is a confirmed PT-BR dub (name carries DUBLADO/PT-BR
        # markers) is exactly what this hunt exists to find. PT-translated
        # titles ("Shang-Chi e a Lenda dos Dez Aneis") do NOT carry the English
        # distinctive tokens ("legend", "ten", "rings"), so enforcing them here
        # would silently drop every dubbed release for non-identical titles.
        # Preserve a PT-confirmed row only when it still shares the requested
        # work's identity: at least one proper-noun/work token, or a strong
        # similarity for single-token titles. A PT-tagged row from a different
        # entry in the same franchise ("Star Wars Andor" when hunting "The
        # Mandalorian") does NOT match and stays filtered out.
        def _is_pt_confirmed(t) -> bool:
            import re as _re
            nm = (t.get("name") or "").upper()
            return bool(_re.search(r"(DUBLAD|PT[- ]BR|PORTUGU[EÊ]S|BRAZILIAN)", nm))

        filtered = []
        for t in result:
            nk = _norm_key(t.get("name", ""))
            if _is_pt_confirmed(t):
                if pt_work_tokens and any(w in nk for w in pt_work_tokens):
                    filtered.append(t)
                elif not pt_work_tokens and similarity(base, t.get("name", "")) >= _SHORT_SIM_MIN:
                    filtered.append(t)
                continue
            if numeric:
                # e.g. "Divertida Mente 2": the "2" must be present.
                if any(tok in nk for tok in numeric):
                    filtered.append(t)
            elif distinctive:
                # Require ALL distinctive tokens, not just one. This keeps
                # "O Senhor dos Anéis" (needs "senhor" AND "aneis"/"anel") while
                # dropping "Sim Senhor", "Um Senhor Estagiario", "Senhor das
                # Armas" which share only "senhor". For titles whose distinctive
                # set is a translated PT word ("senhor aneis" vs release "anel"),
                # accept when the majority of distinctive tokens are present.
                hits = sum(1 for tok in distinctive if tok in nk)
                if hits == len(distinctive) or (hits >= len(distinctive) - 1 and len(distinctive) >= 2):
                    filtered.append(t)
            elif anchor in _FRANCHISE_ANCHORS:
                # Franchise but no distinctive tokens found: fall back to sim.
                if similarity(base, t.get("name", "")) >= _SHORT_SIM_MIN:
                    filtered.append(t)
            else:
                # Single-distinctive-token title ("Avatar"): anchor is the film.
                if anchor in nk or (distinctive and any(tok in nk for tok in distinctive)):
                    filtered.append(t)
    else:
        # Tiny pool (1-2 rows): every token is shared by definition. Trust the
        # shared similarity metric so PT-translated titles survive.
        filtered = [t for t in result if similarity(base, t.get("name", "")) >= _SHORT_SIM_MIN]
    for t in filtered:
        t.pop("_variant", None)
    result = filtered
    _cache_set(cache_key, result)
    return result


if __name__ == "__main__":
    import sys
    query = sys.argv[1] if len(sys.argv) > 1 else "avatar"
    print(json.dumps({"query": query, "results": search_pt(query)[:20]}, indent=2))
