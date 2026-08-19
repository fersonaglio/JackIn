#!/usr/bin/env python3
import os
import sys
import json
import time
import functools
import urllib.parse
import urllib.error
import argparse
import re
import hashlib
from pathlib import Path

from config import MEDIA_APIS, TRACKERS_QUERY, get_unverified_context, get_session
from normalize import is_series, season_of, series_base_title, clean_title, normalize_key
from matcher import similarity
from query_expansion import expand_queries, _fold
from sources import search_all
from sources_br import search_pt
from sources_br_sites import search_wp_sites
from search_data import (
    GENERIC_BLOCKLIST,
    SPECIAL_MOVIE_MAP,
    TRANSLATIONS,
    BLACKLIST_LANGS,
    PT_AUDIO_MARKERS,
    MIN_RELEVANCE,
    MIN_CANDIDATES,
    MAX_OPTIONS,
    MIN_SEEDERS,
    QUALITY_TIERS,
    SIZE_TIERS,
    SCORE_WEIGHTS,
    JUNK_PATTERNS,
)

def detect_audio_info(file_name: str) -> str:
    name_upper = file_name.upper().replace(".", " ").replace("_", " ")
    info = classify_audio(file_name)
    has_es = any(tag in name_upper for tag in ["LATINO", "ESPANOL", "CASTELLANO"])
    has_dolby = any(tag in name_upper for tag in ["ATMOS", "TRUEHD", "DTS-HD", "DTS", "DDP5", "DDP7"])
    has_5_1 = any(tag in name_upper for tag in ["5.1", "6CH", "5 1"])

    parts = []
    if has_dolby:
        parts.append("Dolby Atmos" if "ATMOS" in name_upper else "DTS-HD" if "DTS-HD" in name_upper else "Surround")
    elif has_5_1:
        parts.append("5.1")
    else:
        parts.append("Stereo")

    if info["ptConfirmed"]:
        parts.append("Dublado PT-BR")
        if info.get("hasPtSubtitles"):
            parts.append("Legendado PT-BR")
    elif info.get("hasPtSubtitles"):
        parts.append("Legendado PT-BR")
    elif has_es:
        parts.append("Multi Áudio")
    return " / ".join(parts)

def classify_audio(name: str) -> dict:
    """Classify the audio language/subtitle type from a torrent name.

    `ptConfirmed` is True ONLY when the name carries an explicit Portuguese
    marker (DUBLADO, PT-BR, PORTUGUES...) — a bare "DUAL"/"MULTI" does NOT
    confirm Portuguese, so it is labelled honestly as dual/multi.

    `hasPtSubtitles` is True when the release carries Portuguese subtitles:
    - an explicit "LEGENDADO" marker, OR
    - any PT-confirmed release (a Brazilian dub always ships PT subs), OR
    - a curated PT "DUAL ÁUDIO" release (accented — Brazilian torrent sites use
      this spelling, and those files carry PT-BR subs; generic "DUAL AUDIO" does
      not qualify).
    """
    n = name.upper().replace(".", " ").replace("_", " ")
    has_dual = bool(re.search(r"\b(DUAL[ -]?AUDIO|DUAL)\b", n))
    has_pt = any(tag in n for tag in PT_AUDIO_MARKERS)
    has_leg = bool(re.search(r"\b(LEGENDADO|LEGENDADOS|SUBBED|SUBTITLED|SUBS)\b", n))
    has_pt_leg = bool(re.search(r"\b(LEGENDADO|LEGENDADOS)\b", n))
    has_multi = bool(re.search(r"\bMULTI[ -]?AUDIO|MULTI\b", n))
    has_es = bool(re.search(r"\b(LATINO|ESPANOL|CASTELLANO)\b", n))
    has_pt_dual = bool(re.search(r"\bDUAL\s*ÁUDIO\b", n))

    if has_dual or (has_pt and has_multi):
        audio_type = "dual"
    elif has_pt:
        audio_type = "dub"
    elif has_multi:
        audio_type = "multi"
    elif has_es:
        audio_type = "other"
    else:
        audio_type = "unknown"

    has_pt_sub = has_pt_leg or has_pt or has_pt_dual
    # A curated "DUAL ÁUDIO" (accented — Brazilian torrent sites) ships PT-BR +
    # original audio, so it IS a Portuguese-dubbed release for the user. A bare
    # "DUAL AUDIO" (unaccented) stays ambiguous and honest.
    pt_confirmed = has_pt or has_pt_dual
    # "DUAL" without explicit PT markers — detect PT context via common Brazilian
    # torrent title tokens. A release like "Title (2000) [1080p][Dual]" with PT
    # words ("do", "da", "dos", "das") is a Brazilian release with PT audio.
    if has_dual and not pt_confirmed:
        pt_tokens = len(re.findall(r"\b(DO|DA|DOS|DAS)\b", n))
        if pt_tokens >= 1:
            pt_confirmed = True
            has_pt_sub = True
    return {"audioType": audio_type, "hasSubtitles": has_leg or has_pt_sub, "ptConfirmed": pt_confirmed, "hasPtSubtitles": has_pt_sub}

def _audio_bonus(name: str, pref: str) -> float:
    if not pref or pref == "any":
        return 0.0
    info = classify_audio(name)
    at = info["audioType"]
    if pref == "dub":
        if at == "dub":
            return 0.30
        if at == "dual":
            return 0.20
        if at == "multi":
            return 0.10
    elif pref == "ptbr":
        # Strict PT: heavily favour confirmed-PT audio, then dual/multi.
        # Legendado (hasPtSubtitles) is a valid fallback when no dubs exist.
        if at == "dub":
            return 0.40
        if at == "dual":
            return 0.30
        if at == "multi":
            return 0.20
        if info["hasPtSubtitles"]:
            return 0.15
    elif pref == "original":
        if at == "unknown":
            return 0.10
    elif pref == "legendado":
        if info["hasPtSubtitles"]:
            return 0.40
        if info["hasSubtitles"]:
            return 0.10
    return 0.0

def quality_tier(name: str) -> str:
    n = name.upper()
    if "REMUX" in n:
        return "REMUX"
    if any(x in n for x in ["2160P", "4K", "UHD", "HDR"]):
        return "4K"
    if "1080P" in n or "1080" in n:
        return "1080P"
    if "720P" in n or "720" in n:
        return "720P"
    if "WEBRIP" in n or "WEB-DL" in n or "WEB DL" in n or "HDRIP" in n:
        return "WEBRIP"
    return "OTHER"

def is_junk(name: str) -> bool:
    s = name.lower()
    return any(re.search(p, s) for p in JUNK_PATTERNS)


# Franchise/multi-movie packs ("Pirates 1-5 Collection", "Fast & Furious Boxset").
# They never map to a single film group and only pollute the results as a
# standalone "Title 1 5 Collection" row. A "collection/boxset/saga/trilogy"
# token alone is NOT enough (legit movies like "The Collection" exist) — the
# name must also carry 2+ standalone digits or a numeric range.
_MOVIE_PACK_RANGE_RE = re.compile(r"\b\d+\s*[-–—]\s*\d+\b", re.IGNORECASE)
_MOVIE_PACK_WORD_RE = re.compile(r"\b(collection|box\s*set|boxset|trilogy|saga|franchise|collectors?\s+edition)\b", re.IGNORECASE)
# Genuine series packs carry a season marker ("S01", "Season 1", "Complete Series")
# and are useful — they must NOT be dropped by the movie-pack filter.
_SERIES_PACK_RE = re.compile(r"\b(season\s*\d+|s\d{1,3}\b|complete\s+series)\b", re.IGNORECASE)


def is_movie_pack(name: str) -> bool:
    if _MOVIE_PACK_RANGE_RE.search(name):
        return True
    if _MOVIE_PACK_WORD_RE.search(name):
        return len(re.findall(r"\b\d+\b", name)) >= 2
    return False


def _is_series_pack(name: str) -> bool:
    return bool(_SERIES_PACK_RE.search(name))

def language_allowed(name: str) -> bool:
    name_upper = name.upper()
    tokens = re.split(r"[\s.\-_\[\]\(\)]+", name_upper)
    for token in tokens:
        if token in BLACKLIST_LANGS:
            if not any(x in name_upper for x in ["PTBR", "PT-BR", "PORTUGUESE", "DUBLADO"]):
                return False
    return True

def size_sanity(tier: str, size_gb: float) -> float:
    lo, hi = SIZE_TIERS.get(tier, SIZE_TIERS["OTHER"])
    if size_gb <= 0:
        return 0.0
    if lo <= size_gb <= hi:
        return 1.0
    if size_gb < lo:
        return max(0.0, size_gb / lo)
    return max(0.0, hi / size_gb)

def _queries(q) -> list:
    """Normalize the query arg to a list. Accepts a single string or a list —
    multi-alias ranking lets PT-title torrents match the PT title while EN
    torrents match the EN query."""
    if isinstance(q, (list, tuple)):
        return [x for x in q if x]
    return [q] if q else []


ARTICLES = {"the", "a", "an"}


def _base_match(base: str, name: str) -> bool:
    """True when `base` is a PREFIX of the name's clean tokens (base title +
    part number), NOT an embedded/substring occurrence. Prevents a generic PT
    alias ("A Origem") from matching unrelated films that merely end with the
    phrase ("Hell House: A Origem"), while "Homem de Ferro" still matches
    "Homem de Ferro 2".
    """
    pt_toks = normalize_key(base).split()
    name_toks = normalize_key(name).split()
    if not pt_toks or len(name_toks) < len(pt_toks):
        return False
    if name_toks[:len(pt_toks)] == pt_toks:
        return True
    base_no_art = [w for w in pt_toks if w not in ARTICLES]
    name_no_art = [w for w in name_toks if w not in ARTICLES]
    if base_no_art and len(name_no_art) >= len(base_no_art):
        if name_no_art[:len(base_no_art)] == base_no_art:
            return True
    return False


_NEUTRAL_EXTRA_WORDS = {
    "the", "a", "an", "of", "and", "or", "in", "on", "for", "to", "at",
    "de", "do", "da", "dos", "das", "e", "o", "as", "os", "um", "uma",
    "part", "parte", "vol", "volume", "ep", "episode", "capitulo",
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
    "ten", "um", "dois", "tres", "quatro", "cinco",
}

# Quality and audio tags that normalize_key strips out of torrent names (from
# normalize.py TAG_RE). When the candidate torrent name contains only these
# extra tokens beyond the search query, the relevance gate must still pass.
_QUALITY_AND_AUDIO_TAGS: set[str] = {
    "1080p", "720p", "480p", "576p", "2160p", "4k", "uhd", "hdr", "hdr10",
    "remux", "bluray", "bdrip", "brrip", "webrip", "web-dl", "webdl", "hdtv",
    "h264", "x264", "x265", "hevc", "av1", "avc", "aac", "dts", "dts-hd",
    "ac3", "atmos", "ddp5", "dd5", "truehd", "mp4", "mkv", "avi", "webm",
    "dublado", "dual", "audio", "legendado", "portugues", "english",
}


def _strong_match(query: str, name: str) -> bool:
    """Primary-query relevance.

    The query must be a PREFIX of the candidate's clean tokens ("Iron Man 2",
    "Star Wars: The Force Awakens", "Avatar: The Way of Water", "Silo Season 1"),
    or the candidate must only add neutral tokens. This rejects cross-franchise
    containment where the query is just an embedded subtitle or episode title —
    "iron man" must NOT match "Tetsuo: The Iron Man", and "silo" must NOT match
    "Dimension 20 S28E04 The Silo" — while keeping sequels and saga entries.
    """
    q_toks = normalize_key(query).split()
    if not q_toks:
        return False
    if len(q_toks) < 2:
        if _base_match(query, name):
            return True
        n_toks = normalize_key(name).split()
        if not n_toks:
            return False
        n_no_art = [w for w in n_toks if w not in ARTICLES]
        q_no_art = [w for w in q_toks if w not in ARTICLES]
        if q_no_art and n_no_art and n_no_art[:len(q_no_art)] == q_no_art:
            return True
        return False
    n_toks = normalize_key(name).split()
    if n_toks[:len(q_toks)] == q_toks or _base_match(query, name):
        return True
    qset, nset = set(q_toks), set(n_toks)
    if qset <= nset:
        for t in (nset - qset):
            if re.fullmatch(r"\d+", t):
                continue
            if t in _NEUTRAL_EXTRA_WORDS or t in _QUALITY_AND_AUDIO_TAGS:
                continue
            return False
        return True
    # No prefix and no containment → reject. A multi-token query must anchor the
    # candidate (base title), never match via a loose substring similarity —
    # that is how "iron man"/"iron man 1" incorrectly pulled in "Tetsuo: The
    # Iron Man".
    return False


def _relevance_pass(name: str, queries: list) -> bool:
    """Relevance gate across query aliases. The primary query uses the strict
    strong-match (no cross-franchise containment); alias queries (PT title)
    additionally require a base-title prefix match so generic subtitles don't
    create false positives."""
    for i, x in enumerate(queries):
        if i == 0:
            if _strong_match(x, name):
                return True
        else:
            if similarity(x, name) >= MIN_RELEVANCE and _base_match(x, name):
                return True
    return False


def candidate_score(query, t: dict, audio_pref: str = "") -> float:
    name = t.get("name", "")
    seeders = min(int(t.get("seeders", "0") or 0), 200)
    tier = quality_tier(name)
    size_gb = int(t.get("size", "0") or 0) / (1024 ** 3)
    sim = max((similarity(x, name) for x in _queries(query)), default=0.0)
    tier_score = 1.0 - (QUALITY_TIERS.index(tier) / len(QUALITY_TIERS))
    sane = size_sanity(tier, size_gb)
    seed_norm = min(seeders / 50, 1.0)

    w = SCORE_WEIGHTS
    score = (w["seeders"] * seed_norm
             + w["relevance"] * sim
             + w["quality"] * tier_score
             + w["size_sanity"] * sane
             + _audio_bonus(name, audio_pref))
    if is_junk(name):
        score -= 0.5

    # Season mismatch penalty (exact season requested but torrent is another)
    qs = next((season_of(x) for x in _queries(query) if season_of(x) is not None), None)
    ts = season_of(name)
    if qs is not None and ts is not None and qs != ts:
        score *= 0.4
    return score

def rank_torrents(query, torrents: list, audio_pref: str = "") -> list:
    scored = []
    strict_pt = audio_pref == "ptbr"
    queries = _queries(query)
    for t in torrents:
        seeders = int(t.get("seeders", "0") or 0)
        if seeders < MIN_SEEDERS:
            continue
        name = t.get("name", "")
        if is_junk(name):
            continue
        if is_movie_pack(name) and not _is_series_pack(name):
            continue
        if not language_allowed(name):
            continue
        if not _relevance_pass(name, queries):
            continue
        # Strict PT mode: only releases with a confirmed-PT signal (name marker
        # or previously verified download) are allowed through. Legendado
        # (hasPtSubtitles) releases also pass — they are a valid PT-BR fallback.
        if strict_pt:
            info = classify_audio(name)
            known = _pt_knowledge(t.get("info_hash"))
            confirmed = bool(info.get("ptConfirmed") or (known and known.get("pt")))
            has_pt_subs = info.get("hasPtSubtitles")
            if not confirmed and not has_pt_subs:
                continue
        scored.append((candidate_score(queries, t, audio_pref), t))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [t for _, t in scored]


def _norm_title_key(s: str) -> str:
    key = " ".join(w for w in normalize_key(s).split() if w not in ARTICLES)
    if not key:
        # normalize_key strips years — a film titled with a year ("2012",
        # "1941") would collapse to "" and never exact-match. Recover the
        # year token so it can serve as the title key.
        m = re.search(r"\b(19\d\d|20\d\d)\b", s)
        if m:
            return m.group(1)
    return key


_SMALL_WORDS = {"a", "an", "the", "and", "but", "or", "for", "nor", "of", "on", "in", "to", "at", "by", "from", "with", "vs", "versus"}


def _title_case(text: str) -> str:
    """Capitalize a plain (lowercased) title without breaking small words.

    "pirates of the caribbean" -> "Pirates of the Caribbean"
    "the mandalorian season 1" -> "The Mandalorian Season 1"
    """
    words = text.split()
    out = []
    for i, w in enumerate(words):
        lower = w.lower()
        if i > 0 and lower in _SMALL_WORDS:
            out.append(lower)
        else:
            out.append(w[:1].upper() + w[1:])
    return " ".join(out)


def dedup_by_display(items: list) -> list:
    """Collapse duplicate display rows (same enriched title/type) into one,
    merging download options.

    Multiple torrent groups often map to the same film (torrents named "Title",
    "Title 1" and "Title: Subtitle" all enrich to the same TMDB row). The first
    (highest-ranked) row wins; a row with an empty year merges into the
    same-title row that carries a year. Rows with the same title but different
    non-empty years are distinct films and are kept apart.
    """
    out: list = []
    for r in items:
        merged_into = None
        for i, prev in enumerate(out):
            if prev.get("mediaType") != r.get("mediaType"):
                continue
            if normalize_key(prev.get("title", "")) != normalize_key(r.get("title", "")):
                continue
            py, ry = prev.get("year"), r.get("year")
            if py == ry or not py or not ry:
                merged_into = i
                break
        if merged_into is not None:
            prev = out[merged_into]
            have = {o.get("sourceUrl") for o in prev.get("options", [])}
            for o in r.get("options", []):
                if o.get("sourceUrl") not in have:
                    prev["options"].append(o)
                    have.add(o.get("sourceUrl"))
            if not prev.get("year") and r.get("year"):
                prev["year"] = r["year"]
            continue
        out.append(r)
    return out


def exact_match_for(query: str, translated_query: str, group_title: str, season, pt_title: str = "") -> bool:
    """Deterministic "is this the exact title" check (translation + season aware).

    Compares the normalized query (raw, translated and PT title hint) against the group title,
    ignoring articles; for series it also requires the season to match.
    """
    g_key = _norm_title_key(group_title)
    if not g_key:
        return False
    keys = [_norm_title_key(query), _norm_title_key(translated_query)]
    if pt_title and pt_title.strip():
        keys.append(_norm_title_key(pt_title.strip()))
    if any(k and k == g_key for k in keys):
        qs = season_of(query)
        if qs is not None and season is not None and qs != season:
            return False
        return True
    return False

def parse_movie_name_and_year(name: str):
    match = re.search(r'\b(19\d\d|20[0-2]\d)\b', name)
    if match:
        year = match.group(1)
        title_part = name.split(year)[0].strip(" .-_[]()")
        title_clean = clean_title(title_part)
        if not title_clean:
            # Year-titled film (e.g. "2012", "1941"): the FIRST 4-digit token IS
            # the title, and the NEXT one (when present) is the release year —
            # e.g. "2012.2009.1080p.BluRay.x264" -> title "2012", year "2009".
            title_clean = year
            after = name[match.end():]
            next_year = re.search(r'\b(19\d\d|20[0-2]\d)\b', after)
            year = next_year.group(1) if next_year else ""
        return title_clean, year
    return clean_title(name), ""

def _series_group_title(query: str, name: str) -> str:
    """Extract a clean series name from a torrent name, guided by the query.
    
    Strips all tags and encoding noise, then extracts the portion that best
    matches the query tokens — so "The Last of Us Convergence framesto Season 2"
    becomes "the last of us" instead of "the last of us convergence framesto".
    """
    clean = normalize_key(name)
    clean_no_season = re.sub(r"\bseason\s+\d+\b", "", clean).strip()
    clean_no_season = " ".join(clean_no_season.split())
    
    query_key = normalize_key(query)
    query_tokens = set(query_key.split())
    clean_tokens = clean_no_season.split()
    
    if not clean_tokens:
        return clean_no_season or query
    
    # Find the longest window of tokens that has high query overlap
    best_start = 0
    best_len = 0
    best_ratio = 0.0
    for i in range(len(clean_tokens)):
        for j in range(i + 1, min(i + 20, len(clean_tokens) + 1)):
            window = set(clean_tokens[i:j])
            overlap = window & query_tokens
            ratio = len(overlap) / max(len(window), len(query_tokens))
            length = j - i
            if ratio > best_ratio or (ratio == best_ratio and length > best_len):
                best_ratio = ratio
                best_len = length
                best_start = i
    
    if best_ratio >= 0.4:
        leading = clean_tokens[:best_start]
        if not leading or all(w in ARTICLES for w in leading):
            return " ".join(clean_tokens[best_start:best_start + best_len])
    
    return clean_no_season

def group_torrents(query, ranked: list) -> list:
    queries = _queries(query)
    groups = {}
    for t in ranked:
        name = t.get("name", "")
        if is_series(name):
            base = _series_group_title(queries[0] if queries else name, name)
            season = season_of(name)
            key = ("series", base, season)
            display = f"{base} Season {season}" if season else base
            group = groups.setdefault(key, {"title": display, "year": "", "season": season, "torrents": [], "isSeries": True})
        else:
            parsed = parse_movie_name_and_year(name)
            if not parsed:
                continue
            title_clean, year = parsed
            key = ("movie", title_clean.lower(), year)
            group = groups.setdefault(key, {"title": title_clean, "year": year, "season": None, "torrents": [], "isSeries": False})
        group["torrents"].append(t)

    # Similarity of the closest torrent in each group to the query (best of any
    # alias — so a PT-title group like "Homem de Ferro 2" scores against the PT
    # title, not just the EN query).
    # Series groups with a season that does NOT match the requested one get
    # their match score lowered so the UI never suggests the wrong season.
    query_season = next((season_of(x) for x in queries if season_of(x) is not None), None)
    for group in groups.values():
        sim = max((max(similarity(x, t.get("name", "")) for x in queries) for t in group["torrents"]), default=0.0)
        gs = group.get("season")
        if query_season is not None and gs is not None and query_season != gs:
            sim *= 0.4
        group["matchScore"] = sim
    return list(groups.values())

TIER_META = {
    "REMUX": {"quality": "4K REMUX (Torrent)", "resolution": "3840x2160 (HDR10+ / Dolby Vision)", "bitrate": "~65 Mbps P2P", "format": "MKV", "audio": "Dolby Atmos / TrueHD 7.1"},
    "4K": {"quality": "4K Ultra HD (Torrent)", "resolution": "3840x2160 (HDR)", "bitrate": "~22 Mbps P2P", "format": "MP4 (HEVC)", "audio": "5.1 Surround"},
    "1080P": {"quality": "1080p Full HD (Torrent)", "resolution": "1920x1080", "bitrate": "~8 Mbps P2P", "format": "MP4 (x264)", "audio": "Stereo / 5.1"},
    "720P": {"quality": "720p HD (Torrent)", "resolution": "1280x720", "bitrate": "~4 Mbps P2P", "format": "MP4 (x264)", "audio": "Stereo"},
    "WEBRIP": {"quality": "WEBRip (Torrent)", "resolution": "Variável", "bitrate": "~3 Mbps P2P", "format": "MP4", "audio": "Original"},
    "OTHER": {"quality": "Melhor Disponível (Torrent)", "resolution": "Variável", "bitrate": "P2P", "format": "MKV / MP4", "audio": "Original"},
}

def tier_to_option(t: dict, tier: str) -> dict:
    seeders = int(t.get("seeders", "0") or 0)
    try:
        raw_size = float(t.get("size", "0") or 0)
        size_gb = round(raw_size / (1024 ** 3), 1) if raw_size > 0 else 0.0
    except (TypeError, ValueError):
        size_gb = 0.0
    meta = TIER_META.get(tier, TIER_META["OTHER"])
    name = t.get("name", "")
    audio_info = classify_audio(name)
    known = _pt_knowledge(t.get("info_hash"))
    pt_confirmed = bool(audio_info.get("ptConfirmed") or (known and known.get("pt")))
    pt_excluded = bool(known is not None and not known.get("pt"))
    fmt = meta["format"]
    if tier == "OTHER" and "." in name:
        ext = name.split(".")[-1]
        fmt = ext.upper() if len(ext) <= 4 else "MKV"
    magnet = f"magnet:?xt=urn:btih:{t['info_hash']}&dn={urllib.parse.quote(name)}{TRACKERS_QUERY}"
    return {
        "id": f"{tier.lower()}-" + (t.get("info_hash", "")[:8] or "x"),
        "tier": tier,
        "quality": meta["quality"],
        "badge": f"⚡ {seeders} Seeds",
        "resolution": meta["resolution"],
        "bitrate": meta["bitrate"],
        "size": f"{size_gb} GB" if size_gb > 0 else "",
        "seeders": seeders,
        "audio": detect_audio_info(name) or meta["audio"],
        "audioType": audio_info["audioType"],
        "hasSubtitles": audio_info["hasSubtitles"],
        "hasPtSubtitles": audio_info["hasPtSubtitles"],
        "ptConfirmed": pt_confirmed,
        "ptExcluded": pt_excluded,
        "format": fmt,
        "sourceUrl": magnet,
    }

TIER_ORDER = ["REMUX", "4K", "1080P", "720P", "WEBRIP", "OTHER"]

_PT_KNOWLEDGE: dict = {}
_PT_KNOWLEDGE_TS: float = 0.0
_PT_KNOWLEDGE_TTL = 120.0


def _pt_knowledge(info_hash: str):
    """Learned per-release knowledge: does this infohash contain PT audio?

    Populated after each download by the server (ffprobe) and persisted in
    `pt_releases.json`. Returns {"pt": bool, "langs": [...]} or None. Reloads
    when the file changes (mtime) so freshly-verified downloads apply quickly.
    """
    global _PT_KNOWLEDGE, _PT_KNOWLEDGE_TS
    if not info_hash:
        return None
    path = Path(__file__).resolve().with_name("pt_releases.json")
    try:
        mtime = path.stat().st_mtime if path.exists() else 0
    except Exception:
        mtime = 0
    if (not _PT_KNOWLEDGE_TS) or mtime > _PT_KNOWLEDGE_TS or (time.time() - _PT_KNOWLEDGE_TS > _PT_KNOWLEDGE_TTL):
        try:
            _PT_KNOWLEDGE = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        except Exception:
            _PT_KNOWLEDGE = {}
        _PT_KNOWLEDGE_TS = time.time()
    return _PT_KNOWLEDGE.get(info_hash.lower())


def _dubbed_priority(t: dict) -> int:
    info = classify_audio(t.get("name", ""))
    at = info.get("audioType")
    base = {"dual": 3, "dub": 2, "multi": 1}.get(at, 0)
    # Confirmed PT (name marker or learned from a previous download) always wins.
    if info.get("ptConfirmed"):
        return base + 4
    known = _pt_knowledge(t.get("info_hash"))
    if known is not None:
        if known.get("pt"):
            return base + 5
        return -5
    return base

def build_options(torrents: list, max_options: int = MAX_OPTIONS) -> list:
    """Build the option list guaranteeing dubbed + legendado + original
    representation when such candidates exist in the pool.

    Dubbed selection prefers DUAL (original + PT in one file) and, among the
    same priority, the best-ranked candidate (most seeders / relevance) — never
    the weakest. The final list is ordered by quality tier then seeders so the
    strongest, most reliable source leads.
    """
    ordered = list(torrents)
    selected = []
    used = set()

    def pick(items) -> bool:
        for t in items:
            h = t.get("info_hash")
            if h and h not in used:
                used.add(h)
                selected.append(tier_to_option(t, quality_tier(t.get("name", ""))))
                return True
        return False

    def bucket(name):
        return classify_audio(name).get("audioType")

    # Prefer highest priority (confirmed PT > dual > dub > multi), then the
    # best-ranked one. Releases already known (via ffprobe) to NOT contain PT
    # are excluded so they are never offered as the "dubbed" choice.
    all_dubbed = [t for t in ordered if bucket(t.get("name", "")) in ("dual", "dub", "multi")]

    def known_without_pt(t) -> bool:
        known = _pt_knowledge(t.get("info_hash"))
        return known is not None and not known.get("pt")

    dubbed = sorted(
        [t for t in all_dubbed if not known_without_pt(t)],
        key=lambda t: (_dubbed_priority(t), -ordered.index(t)),
        reverse=True,
    )
    legendado = [t for t in ordered if classify_audio(t.get("name", "")).get("hasSubtitles")]
    original = [t for t in ordered if bucket(t.get("name", "")) == "unknown"]

    # Pass 1 — mandatory representation (when the pool has them)
    pick(dubbed)
    pick(legendado)
    pick(original)

    # Pass 2 — diversity: one ORIGINAL option per quality tier. A tier already
    # satisfied by an original pick is skipped, so a second REMUX (or any
    # duplicate tier) never crowds the list while the best 1080p/4K still lands.
    # Dubbed/legendado picks (pass 1) do NOT satisfy a tier on their own, keeping
    # e.g. a high-seed 1080p original alongside a 1080p DUAL option.
    satisfied = {o.get("tier", "OTHER") for o in selected}
    for tier in TIER_ORDER:
        if len(selected) >= max_options:
            break
        if tier in satisfied:
            continue
        picked = pick([t for t in ordered if quality_tier(t.get("name", "")) == tier])
        if picked:
            satisfied.add(selected[-1].get("tier", "OTHER"))

    # Order the final list by quality tier, then by seeders (most reliable first)
    def seeders_of(opt):
        m = re.search(r"⚡\s*(\d+)", opt.get("badge", ""))
        return int(m.group(1)) if m else 0

    # Drop duplicate (tier, audioType) rows. Pass 2 may add a second option of
    # the same tier when the first representative was a dubbed/multi pick (only
    # "unknown" satisfied the tier), which yielded repeated "4K MULTI" cards.
    # Keeping distinct audioTypes per tier is still desired (original + DUAL on
    # 1080p), so the key is (tier, audioType), not tier alone.
    deduped = []
    seen_keys = set()
    for opt in selected:
        key = (opt.get("tier", "OTHER"), opt.get("audioType", "unknown"))
        if key in seen_keys:
            continue
        seen_keys.add(key)
        deduped.append(opt)

    # Order: PT-BR options (dub/legendado/dual-PT) lead, then quality tier, then
    # seeders — so a Brazilian user sees the dubbed/subtitled release up front
    # instead of it being buried behind large original-language REMUX files.
    def pt_rank(o):
        if o.get("ptConfirmed") or o.get("hasPtSubtitles"):
            return 0
        if o.get("audioType") in ("dual", "multi"):
            return 1
        return 2

    deduped.sort(key=lambda o: (pt_rank(o), TIER_ORDER.index(o.get("tier", "OTHER")), -seeders_of(o)))
    return deduped[:max_options]

_MOVIE_KINDS = ("feature-movie", "movie")
_AUDIOBOOK_TITLE_RE = re.compile(r"\b(unabridged|abridged|read\s+by\b|narrated\s+by\b|audiobook|audible)\b", re.IGNORECASE)


def _is_movie_item(item: dict) -> bool:
    """True when the iTunes item is a movie (never an audiobook/music track).

    iTunes audiobooks carry wrapperType="track" and kind="audiobook", so the
    loose "wrapperType == track" test let their artwork leak into movie cards
    (e.g. "Pirates of the Caribbean ... Read by Simon Vance"). Only explicit
    movie kinds are accepted here, and titles that still read as audiobooks
    are rejected defensively.
    """
    kind = item.get("kind", "")
    if kind not in _MOVIE_KINDS:
        return False
    name = str(item.get("trackName") or item.get("collectionName") or "")
    return not _AUDIOBOOK_TITLE_RE.search(name)


def _wikipedia_lookup(title: str) -> dict:
    try:
        clean = " ".join(title.split())
        candidates = [clean]
        if "altas aventuras" in clean.lower() or "up" in clean.lower():
            candidates = ["Up - Altas Aventuras", "Up (filme)", clean]
        session = get_session()
        for c in candidates:
            for lang in ("pt", "en"):
                wiki_title = urllib.parse.quote(c.replace(" ", "_"))
                url = f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{wiki_title}"
                data = None
                try:
                    r = session.get(url, headers={"User-Agent": "JackIn/1.0 (https://github.com/fersonaglio/JackIn)"}, timeout=(2.0, 3.5))
                    if r.status_code == 200:
                        data = r.json()
                except Exception:
                    pass
                if data is None:
                    try:
                        req = urllib.request.Request(url, headers={"User-Agent": "JackIn/1.0 (https://github.com/fersonaglio/JackIn)"})
                        with urllib.request.urlopen(req, context=get_unverified_context(), timeout=3.5) as response:
                            data = json.loads(response.read().decode("utf-8"))
                    except Exception:
                        continue
                thumb = data.get("thumbnail", {}).get("source", "")
                extract = data.get("extract", "")
                if thumb or extract:
                    t_name = data.get("title", clean)
                    if t_name in ("Up (filme)", "Up"):
                        t_name = "Up - Altas Aventuras"
                    return {
                        "title": t_name,
                        "posterUrl": thumb,
                        "backdropUrl": thumb,
                        "overview": extract,
                        "genre": "Filme / Animação",
                        "score": 0.9,
                    }
    except Exception:
        pass
    return {}


def _fetch_itunes_metadata(meta_title: str, year: str, alt_titles: list = None) -> dict:
    """Best-effort metadata (poster/overview/genre/backdrop) for a group title.

    TMDB is preferred when a key is configured: reliable posters, real wide
    backdrops and PT titles (works for PT group titles like "piratas do
    caribe", where iTunes only has audiobooks). iTunes and Wikipedia are keyless fallbacks.
    """
    candidates = [meta_title] + (alt_titles or [])
    for candidate in candidates:
        tmdb = _tmdb_lookup(candidate, year)
        if tmdb and (tmdb.get("posterUrl") or tmdb.get("backdropUrl")):
            matched_year = bool(year) and tmdb.get("matchedYear", False)
            sim = similarity(meta_title, tmdb.get("title") or candidate)
            tmdb["score"] = round(max(sim, 0.9 if matched_year else 0.6), 2)
            return tmdb
        result = _itunes_lookup(candidate, year)
        if result and result.get("posterUrl"):
            result.setdefault("backdropUrl", result.get("posterUrl", ""))
            return result
        wiki = _wikipedia_lookup(candidate)
        if wiki and wiki.get("posterUrl"):
            return wiki
    return {}

def _itunes_lookup(meta_title: str, year: str) -> dict:
    cache_key = f"{meta_title.strip().lower()}|{year}"
    entry = _ITUNES_CACHE.get(cache_key)
    if entry and time.time() - entry['t'] < _ITUNES_CACHE_TTL:
        return entry['v']
    try:
        encoded_title = urllib.parse.quote(meta_title)
        url = f"{MEDIA_APIS['itunes']}?term={encoded_title}&limit=8"
        data = None
        try:
            session = get_session()
            r = session.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=(2.0, 3.5))
            if r.status_code == 200:
                data = r.json()
        except Exception:
            pass
        if data is None:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, context=get_unverified_context(), timeout=3.5) as response:
                data = json.loads(response.read().decode("utf-8"))
        results_list = data.get("results", []) if isinstance(data, dict) else []
        movie_items = [it for it in results_list if _is_movie_item(it)]
        matched_item = None
        for item in movie_items:
            if item.get("releaseDate") and year and year in item.get("releaseDate", ""):
                matched_item = item
                break
        if not matched_item and movie_items:
            matched_item = movie_items[0]
        if matched_item:
            itunes_title = matched_item.get("trackName") or matched_item.get("collectionName") or meta_title
            result = {
                "title": itunes_title,
                "posterUrl": matched_item.get("artworkUrl100", "").replace("100x100bb.jpg", "600x600bb.jpg"),
                "overview": matched_item.get("longDescription") or matched_item.get("shortDescription") or "",
                "genre": matched_item.get("primaryGenreName", ""),
                "score": round(similarity(meta_title, itunes_title), 2),
            }
            _ITUNES_CACHE[cache_key] = {'t': time.time(), 'v': result}
            return result
    except urllib.error.HTTPError as e:
        if e.code in (403, 429):
            return {}  # rate-limit — silently skip
        print(f"Aviso no iTunes individual Metadata ({meta_title}): {e}", file=sys.stderr)
    except Exception as e:
        print(f"Aviso no iTunes individual Metadata ({meta_title}): {e}", file=sys.stderr)
    return {}

# TTL-based cache for iTunes lookups to avoid hammering the API on repeated
# searches for the same title/year combinations (10 minute expiry).
_ITUNES_CACHE: dict = {}
_ITUNES_CACHE_TTL = 600

# Best-effort TMDB backdrop/poster enrichment (needs TMDB_API_KEY). Never blocks.
_TMDB_GENRES = {
    28: "Ação", 12: "Aventura", 16: "Animação", 35: "Comédia", 80: "Crime",
    99: "Documentário", 18: "Drama", 10751: "Família", 14: "Fantasia",
    36: "História", 27: "Terror", 10402: "Música", 9648: "Mistério",
    10749: "Romance", 878: "Ficção Científica", 10770: "Cinema TV",
    53: "Suspense", 10752: "Guerra", 37: "Faroeste",
    10759: "Ação e Aventura", 10762: "Kids", 10763: "Notícias",
    10764: "Reality", 10765: "Sci-Fi & Fantasia", 10766: "Novela",
    10767: "Talk", 10768: "Guerra & Política",
}


@functools.lru_cache(maxsize=256)
def _tmdb_lookup(title: str, year: str) -> dict:
    """Search TMDB for a real wide backdrop + cleaner poster. Best-effort.

    Returns {"backdropUrl","posterUrl","overview","genre","title",
    "matchedYear"} or {} when no key is set, no match is found, or TMDB is
    unreachable. LRU-cached (max 256 entries) — movie metadata does not
    expire.
    """
    key = os.environ.get("TMDB_API_KEY", "").strip()
    if not key:
        return {}
    out: dict = {}
    try:
        params = urllib.parse.urlencode({
            "api_key": key,
            "query": title,
            "language": "pt-BR",
            "include_adult": "false",
        })
        url = f"https://api.themoviedb.org/3/search/multi?{params}"
        data = None
        try:
            session = get_session()
            r = session.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=(2.0, 3.5))
            if r.status_code == 200:
                data = r.json()
        except Exception:
            pass
        if data is None:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, context=get_unverified_context(), timeout=3.5) as response:
                data = json.loads(response.read().decode("utf-8"))

        best = None
        best_year_match = False
        for item in data.get("results", []):
            if item.get("media_type") not in ("movie", "tv"):
                continue
            if not (item.get("backdrop_path") or item.get("poster_path")):
                continue
            # TMDB classifies video games and some fringe entries as media_type

            # "movie"; `video:true` + near-zero engagement is a reliable junk
            # signal (e.g. "Star Wars: Starfighter" surfacing as a film).
            if item.get("video") is True:
                continue
            if (item.get("vote_count") or 0) < 2 and (item.get("popularity") or 0) < 0.6:
                continue
            ryear = (item.get("release_date") or item.get("first_air_date") or "")[:4]
            if year and ryear and year != ryear:
                continue
            best = item
            best_year_match = bool(ryear and year and ryear == year)
            break
        if best is None:
            for item in data.get("results", []):
                if item.get("media_type") in ("movie", "tv") and (item.get("backdrop_path") or item.get("poster_path")):
                    if item.get("video") is True:
                        continue
                    if (item.get("vote_count") or 0) < 2 and (item.get("popularity") or 0) < 0.6:
                        continue
                    best = item
                    best_year_match = False
                    break
        if best:
            if best.get("backdrop_path"):
                out["backdropUrl"] = f"https://image.tmdb.org/t/p/w1280{best['backdrop_path']}"
            if best.get("poster_path"):
                out["posterUrl"] = f"https://image.tmdb.org/t/p/w500{best['poster_path']}"
            if best.get("overview"):
                out["overview"] = best["overview"]
            out["title"] = best.get("title") or best.get("name") or title
            out["originalTitle"] = best.get("original_title") or best.get("original_name") or out["title"]
            out["matchedYear"] = best_year_match
            gids = best.get("genre_ids") or []
            genres = [g for g in (_TMDB_GENRES.get(x) for x in gids) if g]
            if genres:
                out["genre"] = " / ".join(genres[:3])
    except Exception as e:
        print(f"Aviso no TMDB lookup ({title}): {e}", file=sys.stderr)
    return out

def _pool_has_confirmed_pt(pool: dict) -> bool:
    """True if any candidate carries a confirmed-PT signal (name marker, a
    previously verified download, or at least PT subtitles as fallback)."""
    for it in pool.values():
        audio = classify_audio(it.get("name", ""))
        if audio.get("ptConfirmed") or audio.get("hasPtSubtitles"):
            return True
        known = _pt_knowledge(it.get("info_hash"))
        if known and known.get("pt"):
            return True
    return False


def search_media(query: str, audio: str = "", meta_hint: dict = None, pt_title: str = "") -> list:
    results = []
    q = query.strip()
    if not q:
        return results

    q_lower = q.lower()

    if q_lower in GENERIC_BLOCKLIST:
        return results

    # Mapeamento especial para buscas populares e termos curtos
    target_key = q_lower
    if target_key not in SPECIAL_MOVIE_MAP:
        query_tokens = set(q_lower.split())
        for k, v in list(SPECIAL_MOVIE_MAP.items()):
            key_tokens = set(k.split())
            if len(q_lower) >= 4 and query_tokens == key_tokens:
                target_key = k if isinstance(v, list) else v
                break

    if target_key in SPECIAL_MOVIE_MAP and isinstance(SPECIAL_MOVIE_MAP[target_key], str):
        target_key = SPECIAL_MOVIE_MAP[target_key]

    if target_key in SPECIAL_MOVIE_MAP and isinstance(SPECIAL_MOVIE_MAP[target_key], list):
        movie_items = SPECIAL_MOVIE_MAP[target_key]
        for idx, item in enumerate(movie_items):
            meta_title = item["title"]
            original_title = item["originalTitle"]
            torrents = rank_torrents(original_title, search_all(original_title), audio)
            if not torrents:
                continue
            options = build_options(torrents)
            if not options:
                continue
            results.append({
                "id": "torrent-special-" + hashlib.md5((meta_title + item["year"]).encode()).hexdigest()[:12],
                "title": meta_title,
                "originalTitle": original_title,
                "year": item["year"],
                "overview": item["overview"],
                "posterUrl": item["posterUrl"],
                "backdropUrl": item["posterUrl"],
                "genre": item["genre"],
                "rating": item["rating"],
                "mediaType": "movie",
                "matchScore": 1.0,
                "exactMatch": True,
                "ptUnavailable": not _pool_has_confirmed_pt({t.get("info_hash"): t for t in torrents}),
                "options": options
            })
        if results:
            return results

    # Base query for matching (translated to English when a known term appears)
    match_query = q
    q_folded = _fold(q)
    for key, val in TRANSLATIONS.items():
        if key in q_folded:
            match_query = q_folded.replace(key, val)
            break

    # 1. Gather a candidate pool across query variants and sources (>= MIN_CANDIDATES).
    #    Dubbed/legendado candidates surface via the base query (indexers match
    #    title tokens; tag-appended queries like "TITLE DUBLADO" return nothing).
    variants = expand_queries(match_query)

    candidate_pool = {}
    retried = False

    from concurrent.futures import ThreadPoolExecutor

    def hunt_base(tag):
        return list(search_all(f"{match_query} {tag}"))

    def hunt_br(variant):
        return list(search_pt(variant))

    # Hunt both the translated (EN) title and the raw query (keeps Brazilian
    # releases that only appear under the PT title, e.g. "Divertida Mente 2").
    pt_variants = [match_query]
    if q.strip().lower() != match_query.strip().lower():
        pt_variants.append(q.strip())

    # WordPress curated BR sites (baixetorrents.net, mestredosfilmes.top):
    # Prioritize the PT title and original query (avoids redundant queries of translated EN strings on PT sites).
    wp_variants = []
    if pt_title and pt_title.strip():
        wp_variants.append(pt_title.strip())
    if q.strip() not in wp_variants:
        wp_variants.append(q.strip())
    if match_query != q.strip() and match_query not in wp_variants and len(wp_variants) < 2:
        wp_variants.append(match_query)

    # Unify Phase 1 (base variants) + Phase 2 (PT hunts + WP sites) into a single
    # concurrent gathering pool to eliminate sequential latency bottlenecks.
    primary_variants = variants[:4]
    initial_jobs = [lambda s=s: search_all(s) for s in primary_variants]
    initial_jobs += [lambda v=v: hunt_br(v) for v in pt_variants]
    initial_jobs += [lambda v=v: search_wp_sites(v) for v in wp_variants]


    with ThreadPoolExecutor(max_workers=min(len(initial_jobs), 16)) as ex:
        futures = [ex.submit(j) for j in initial_jobs]
        for fut in futures:
            try:
                for it in fut.result():
                    h = it.get("info_hash", "")
                    if not h:
                        continue
                    cur = candidate_pool.get(h)
                    if cur is None or int(it.get("seeders", "0") or 0) > int(cur.get("seeders", "0") or 0):
                        candidate_pool[h] = it
            except Exception:
                continue

    # Extra tagged search only when the pool carries zero confirmed PT or audio == "ptbr"
    if not _pool_has_confirmed_pt(candidate_pool) or audio == "ptbr":
        tagged_jobs = [lambda t=tag: hunt_base(t) for tag in ("DUBLADO", "PT-BR")]
        with ThreadPoolExecutor(max_workers=2) as ex:
            futures = [ex.submit(j) for j in tagged_jobs]
            for fut in futures:
                try:
                    for it in fut.result():
                        h = it.get("info_hash", "")
                        if not h:
                            continue
                        cur = candidate_pool.get(h)
                        if cur is None or int(it.get("seeders", "0") or 0) > int(cur.get("seeders", "0") or 0):
                            candidate_pool[h] = it
                except Exception:
                    continue


    # If still below MIN_CANDIDATES and remaining variants exist, check them
    if len(candidate_pool) < MIN_CANDIDATES and len(variants) > 4:
        extra_jobs = [lambda s=s: search_all(s) for s in variants[4:]]
        with ThreadPoolExecutor(max_workers=min(len(extra_jobs), 4)) as ex:
            futures = [ex.submit(j) for j in extra_jobs]
            for fut in futures:
                try:
                    for it in fut.result():
                        h = it.get("info_hash", "")
                        if not h:
                            continue
                        cur = candidate_pool.get(h)
                        if cur is None or int(it.get("seeders", "0") or 0) > int(cur.get("seeders", "0") or 0):
                            candidate_pool[h] = it
                except Exception:
                    continue

    # Rate-limit retry — when ALL sources return zero (apibay/YTS may
    # throttle after a burst), one delayed retry of the base gather often
    # recovers. No retry for strict-PT mode (the recall pass IS the retry).
    if not candidate_pool and audio != "ptbr" and not retried:
        time.sleep(1.5)
        retried = True
        with ThreadPoolExecutor(max_workers=min(len(primary_variants), 4)) as ex:
            futures = [ex.submit(search_all, s) for s in primary_variants]
            for fut in futures:
                try:
                    for it in fut.result():
                        h = it.get("info_hash", "")
                        if not h:
                            continue
                        cur = candidate_pool.get(h)
                        if cur is None or int(it.get("seeders", "0") or 0) > int(cur.get("seeders", "0") or 0):
                            candidate_pool[h] = it
                except Exception:
                    continue

    # WP candidates hunted under the PT title are curated dubs; hold them apart
    # so they can be force-injected into the exact-match group even when their
    # similarity to the EN query is below MIN_RELEVANCE (e.g. "Vingadores:
    # Ultimato" vs query "Avengers Endgame"). Filtered here by the PT title to
    # keep only rows that actually match the requested work.
    wp_pt_candidates: list = []
    if pt_title:
        pt_sim_floor = 0.30
        for it in list(candidate_pool.values()):
            if classify_audio(it.get("name", "")).get("ptConfirmed") and similarity(pt_title, it.get("name", "")) >= pt_sim_floor:
                wp_pt_candidates.append(it)

    # 2. Filter, score and rank candidates
    #    pt_unavailable is honest across ALL audio modes: when the candidate
    #    pool carries zero confirmed-PT releases, the UI must explain that the
    #    sources exist but none is confirmed as PT dubbed (instead of pretending
    #    the title has no sources at all).
    pool_has_pt = _pool_has_confirmed_pt(candidate_pool)
    pt_unavailable = not pool_has_pt
    # Rank against BOTH the translated EN query and the PT title (when known):
    # EN torrents ("Iron Man 2") match the EN query, PT torrents from the WP
    # sources ("Homem de Ferro 2") match the PT title. Without the alias, PT
    # titles were filtered out by cross-language similarity ~0.
    rank_queries = [match_query]
    if pt_title and pt_title.strip():
        rank_queries.append(pt_title.strip())
    # When the translated query still carries untranslated PT subtitle tokens
    # ("pirates of the caribbean: a maldicao do perola negra"), the strict
    # strong_match prefix check rejects all torrents. Add the clean franchise
    # head as a fallback ranking query so the engine still matches.
    if ":" in match_query or " - " in match_query:
        for sep in (":", " - "):
            if sep in match_query:
                head = match_query.split(sep)[0].strip()
                head_folded = " ".join(head.lower().split())
                if head_folded not in {" ".join(q.lower().split()) for q in rank_queries}:
                    rank_queries.append(head)
                break
    ranked = rank_torrents(rank_queries, list(candidate_pool.values()), audio)
    # Strict PT mode that found nothing: fall back to the general pool (still
    # flagged pt_unavailable) so the UI shows real options instead of empty.
    if not ranked and audio == "ptbr":
        ranked = rank_torrents(rank_queries, list(candidate_pool.values()), "")
    if not ranked:
        return results

    # 3. Group by movie (title, year) or series (base title, season)
    groups = group_torrents(rank_queries, ranked)

    # 3b. Always surface a confirmed-PT (dubbed) release. A Brazilian release is
    #     often grouped under its PT title ("Shang-Chi e a Lenda dos Dez Aneis")
    #     which sorts below the EN-title groups and gets cut by the top-5 slice —
    #     so the modal showed only the 60GB MULTI and hid the real 2GB dub. Inject
    #     confirmed-PT releases from non-exact groups into the exact-match group;
    #     build_options then picks them first as the dubbed option.
    def _is_confirmed_pt(t) -> bool:
        info = classify_audio(t.get("name", ""))
        if info.get("ptConfirmed"):
            return True
        known = _pt_knowledge(t.get("info_hash"))
        return bool(known and known.get("pt"))

    pt_bonus: list = []
    for group in groups:
        if group.get("isSeries"):
            continue
        if not exact_match_for(q, match_query, group["title"], group.get("season"), pt_title):
            pt_bonus.extend(t for t in group["torrents"] if _is_confirmed_pt(t))

    if pt_bonus:
        # Prefer the highest-priority dubbed release, then most-seeded.
        pt_bonus.sort(key=lambda t: (_dubbed_priority(t), int(t.get("seeders", "0") or 0)), reverse=True)
        for group in groups:
            if exact_match_for(q, match_query, group["title"], group.get("season"), pt_title):
                existing_hashes = {t.get("info_hash") for t in group["torrents"]}
                for t in pt_bonus:
                    if t.get("info_hash") and t["info_hash"] not in existing_hashes:
                        group["torrents"].append(t)
                break

    # 3c. Force-inject curated PT dubs found under the PT title. These often
    #     have low similarity to the EN query (below MIN_RELEVANCE) and get cut
    #     by rank_torrents, so even the normal PT injection above misses them.
    #     Attach them to the best group: prefer the exact-match group, otherwise
    #     the highest-scoring group that matches the PT title intent (important
    #     for series, where no EN-title group is an exact match).
    if wp_pt_candidates:
        wp_pt_candidates.sort(key=lambda t: (_dubbed_priority(t), int(t.get("seeders", "0") or 0)), reverse=True)

        def _group_best_score(g):
            return max((candidate_score(match_query, t, audio) for t in g.get("torrents", [])), default=0.0)

        def _best_group():
            exact = [g for g in groups if exact_match_for(q, match_query, g["title"], g.get("season"), pt_title)]
            if exact:
                return exact[0]
            if not groups:
                return None
            scored = sorted(groups, key=lambda g: (g.get("matchScore", 0.0), _group_best_score(g)), reverse=True)
            return scored[0]

        target = _best_group()
        if target is not None:
            existing_hashes = {t.get("info_hash") for t in target["torrents"]}
            for t in wp_pt_candidates:
                if t.get("info_hash") and t["info_hash"] not in existing_hashes:
                    target["torrents"].append(t)

    # 4. Order groups: exact-title match first, then by matchScore and score.
    #    This keeps franchises correct (e.g. "Avatar" (2009) before sequels,
    #    "The Hunger Games" before its prequels). The best-of-aliases scoring
    #    keeps PT-title groups ("Homem de Ferro 2") competitive next to the
    #    EN ones ("Iron Man 2").
    def group_best(g):
        return max(candidate_score(rank_queries, t, audio) for t in g["torrents"])

    def group_exact(g):
        return exact_match_for(q, match_query, g["title"], g.get("season"), pt_title)

    sorted_groups = sorted(
        groups,
        key=lambda g: (group_exact(g), g.get("matchScore", 0.0), group_best(g)),
        reverse=True,
    )[:15]

    # Parallelize metadata lookup across all candidate groups
    def _fetch_group_meta(g):
        meta_title = g["title"]
        year = g["year"]
        if meta_hint is not None and meta_hint.get("title"):
            return {
                "title": meta_hint.get("title", ""),
                "posterUrl": meta_hint.get("posterUrl", ""),
                "overview": meta_hint.get("overview", ""),
                "genre": meta_hint.get("genre", ""),
                "score": round(similarity(meta_title, meta_hint.get("title", "")), 2),
            }
        return _fetch_itunes_metadata(
            meta_title,
            year,
            alt_titles=[match_query] if match_query.lower() != meta_title.lower() else []
        )

    with ThreadPoolExecutor(max_workers=min(max(len(sorted_groups), 1), 8)) as ex:
        group_metas = list(ex.map(_fetch_group_meta, sorted_groups))

    for group, meta in zip(sorted_groups, group_metas):
        meta_title = group["title"]
        year = group["year"]
        torrents = sorted(group["torrents"], key=lambda t: candidate_score(rank_queries, t, audio), reverse=True)
        close = meta.get("score", 0.0) >= 0.5

        # 5. Build up to MAX_OPTIONS options across quality tiers (best per tier)
        options = build_options(torrents)
        if not options:
            continue

        # Display title: prefer the enriched metadata title (nice casing + full
        # subtitle) when it matches; otherwise fall back to a title-cased group
        # title so rows never show raw lowercase names.
        display_title = meta.get("title") if close else _title_case(meta_title)
        distinct_original = bool(close and meta.get("title")
                                 and normalize_key(meta["title"]) != normalize_key(meta_title))
        # originalTitle: the EN/first-title from TMDB (used to merge this row
        # with the English Wikipedia entry for the same film in the web layer).
        en_title = meta.get("originalTitle") or ""
        if en_title and normalize_key(en_title) == normalize_key(display_title):
            en_title = ""

        results.append({
            "id": "torrent-" + hashlib.md5((meta_title + year).encode()).hexdigest()[:12],
            "title": display_title,
            "originalTitle": en_title or (meta_title if distinct_original else ""),
            "year": year,
            "overview": meta.get("overview", "") if close else "",
            "posterUrl": meta.get("posterUrl", "") if close else "",
            "backdropUrl": meta.get("backdropUrl") or (meta.get("posterUrl", "") if close else ""),
            "genre": meta.get("genre", "") if close else "",
            "rating": "",
            "mediaType": "series" if group["isSeries"] else "movie",
            "matchScore": round(group.get("matchScore", 0.0), 2),
            "exactMatch": group_exact(group),
            "ptUnavailable": pt_unavailable,
            "options": options
        })

    # 6. Collapse duplicate display rows (see dedup_by_display).
    return dedup_by_display(results)


def main():
    parser = argparse.ArgumentParser(description="Media Search Engine for JackIn")
    parser.add_argument("--query", type=str, required=True, help="Search query (e.g. Avengers)")
    parser.add_argument("--audio", type=str, default="", help="Audio preference: dub | original | legendado | any")
    parser.add_argument("--pt-title", type=str, default="",
                        help="PT-BR title hint (ex: Vingadores: Ultimato) for the curated WordPress hunt")
    parser.add_argument("--meta-json", type=str, default="",
                        help="Optional catalog metadata hint (title/year/posterUrl/overview/genre) to skip iTunes enrichment")
    args = parser.parse_args()

    meta = None
    if args.meta_json:
        try:
            meta = json.loads(args.meta_json)
        except Exception:
            meta = None
    results = search_media(args.query, args.audio, meta, args.pt_title)
    print(json.dumps({"query": args.query, "results": results}))

if __name__ == "__main__":
    main()
