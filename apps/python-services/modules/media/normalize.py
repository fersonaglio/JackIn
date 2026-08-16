#!/usr/bin/env python3
"""Agressive name normalizer and series/media-type detection.

Torrent names do not follow a pattern. This module reduces ANY name to a
comparable "core key" (lowercase, no accents, no separators, no quality tags,
no years) and detects whether a name refers to a TV series/season/episode.

Rules:
  - `S09E01`, `S9`, `Season 9`, `Season.9` all normalize to the token `season 9`.
  - `Part 2` / `Parte 2` (multi-part movies) are NOT treated as series.
"""
import re
import unicodedata

TAG_RE = re.compile(
    r"\b(REMUX|2160P|1080P|1080|720P|720|480P|576P|UHD|4K|8K|HDR10\+?|HDR|DOLBY\s*VISION|DV|SDR|"
    r"WEB-?DL|WEBRIP|WEB|BLURAY|BDRIP|BRRIP|HDTV|HDRIP|DVDRIP|"
    r"X264|X265|X266|H\.?26[45]|H\s*26[45]|HEVC|AVC|AV1|AAC|DTS-?HD|DTS|AC3|AC\d|TRUEHD\d*(?:\.\d+)?|ATMOS|DD\d?(?:\.\d+)?|"
    r"10BIT|10BITS|8BIT|8BITS|6CH|AAC5|DDP5|DDP7|DD5|5\s*\.?\s*1|7\s*\.?\s*1|2CH|"
    r"MP4|MKV|AVI|WEBM|MOV|CAM|TELESYNC|HDCAM|TS|"
    r"AMZN|DSNP|NF|NETFLIX|HMAX|ATVP|ITUNES|PCOK|HULU|VOD|DISNEY|PEACOCK|PARAMOUNT|HBO|STAN|"
    r"iT(?=[.\-_ ]*(?:WEB-?DL|WEBRIP|DV|HDR|2160P|1080P|720P|DDP|TRUEHD|ATMOS|AC3|HEVC))|"
    r"EXTENDED|UNCUT|UNCENSORED|UNRATED|DIRECTOR'?S?\s*CUT|THEATRICAL|"
    r"MULTI[- .]?AUDIO|DUAL[- .]?AUDIO|DUBLADO|LEGENDADO|PORTUGUES|PORTUGUESE|ENGLISH|ESPAÑOL|SPANISH|PT-?BR|PTBR|"
    r"TORRENT|DOWNLOAD|PROPER|REPACK|LIMITED|IMAX|YTS|YIFY|RARBG|REMASTERED|RERIP|READNFO|SUBS?)\b",
    re.IGNORECASE,
)

# Known release group suffixes that appear in torrent names after all encoding
# tags are stripped. These are NOT movies/series titles.
RELEASE_GROUP_RE = re.compile(
    r"\b(FRAMESTOR|FRAMESTO|XEBEC|NTB|MZABI|RAPTA|PSA|KITSUNE|FLUX|"
    r"BTM|FLU|THEMRG|RGB|TEPES|GALAXY|EVO|CMRG|NTG|"
    r"YTS|YIFY|RARBG|QXR|TIGOLE|UTT|MZABI|ION10|VARYG|JUSTISO|"
    r"BAIXETORRENTS|MESTREDOSFILMES|LIMONTORRENTS|FILMESHDTORRENT|TORRENTDOSFILMES|"
    r"BLUDV|COMANDO\s*\.?\s*TO)\b",
    re.IGNORECASE,
)

YEAR_RE = re.compile(r"\b(19\d\d|20\d\d)\b")

SEASON_CODE_RE = re.compile(r"\bS(\d{1,2})(?:E\d{1,3})?\b", re.IGNORECASE)
SEASON_WORD_RE = re.compile(r"\bSEASON\s*[-:.]?\s*(\d{1,2})\b", re.IGNORECASE)
# Brazilian torrents write seasons as "1ª Temporada", "2ª Temporada",
# "Temporada 1", "Temp 1". Without these, an anime like "Iron Man 1ª
# Temporada" was misclassified as a MOVIE and offered for a film search.
# The ordinal char class accepts ª/º (raw name) and "a" (after strip_accents
# normalizes ª -> a), so it works in both normalize_key and is_series.
SEASON_PT_RE = re.compile(r"\b(\d{1,2})(?:[ªºa])?\s*(?:TEMP(?:ORADA)?)\b|\bTEMP(?:ORADA)?\s*(\d{1,2})\b", re.IGNORECASE)
# A TV episode marker needs an ARABIC number after it: "Episode 5", "Episode.12",
# "Ep 5". "Star Wars Episode V" (roman numeral, film installment) must NOT count
# as a series — that is why `\bEPISODES?\b` alone is not enough.
EPISODE_WORD_RE = re.compile(r"\bEPISODES?[\s.\-_]*\d{1,3}\b|\bEP[\s.\-_]*\d{1,3}\b", re.IGNORECASE)
COMPLETE_SERIES_RE = re.compile(r"\bCOMPLETE[\s._-]+SERIES\b", re.IGNORECASE)
PART_RE = re.compile(r"\bPARTE?\s*[I]{1,3}\b|\bPART\s*\d{1,2}\b|\bPARTE\s*\d{1,2}\b|\bVOL\s*\d{1,2}\b", re.IGNORECASE)

MULTI_PART_ONLY_RE = re.compile(r"\b(COMPLETE[\s._-]+(SERIES|SEASONS?)|BOXSET|BOX[\s._-]+SET)\b", re.IGNORECASE)

YEAR_IN_NAME = YEAR_RE


def _strip_accents(text: str) -> str:
    s = unicodedata.normalize("NFKD", text)
    return "".join(c for c in s if not unicodedata.combining(c))


def _collapse_apostrophes(text: str) -> str:
    """Join word-internal apostrophes so "world's" == "worlds" for grouping.

    Torrents spell the same title both ways ("At.World's.End" vs
    "At.Worlds.End"); without this, "world s end" and "worlds end" become two
    different groups and the UI shows duplicate rows. Word-internal markers are
    dropped ('world's' -> 'worlds'); stray ones (curly quotes, standalone) fall
    through to the separator normalization below.
    """
    s = text.replace("\u2019", "'").replace("\u2018", "'")
    s = re.sub(r"(\w)'(\w)", r"\1\2", s)
    return s.replace("'", " ")


def _canonical_season(match) -> str:
    return f" season {int(match.group(1))} "


def _canonical_pt_season(match) -> str:
    val = match.group(1) or match.group(2)
    return f" season {int(val)} " if val else " "


def normalize_key(text: str) -> str:
    """Reduce any name to a comparable key."""
    s = _strip_accents(text)
    s = TAG_RE.sub(" ", s)
    s = RELEASE_GROUP_RE.sub(" ", s)
    s = YEAR_RE.sub(" ", s)
    s = SEASON_CODE_RE.sub(_canonical_season, s)
    s = SEASON_WORD_RE.sub(_canonical_season, s)
    s = SEASON_PT_RE.sub(_canonical_pt_season, s)
    s = EPISODE_WORD_RE.sub(" episode ", s)
    s = _collapse_apostrophes(s)
    s = re.sub(r"[^a-z0-9]+", " ", s.lower())
    return " ".join(s.split())


def is_series(name: str) -> bool:
    """A name is a series if it contains episodes/season markers.

    Multi-part movies (`Part 2`, `Parte 1`) are NOT series. A bare "Episode N"
    counts as a series ONLY when there is no film year: "Star Wars Episode V ...
    (1980)" and "Star Wars Episode 1: The Phantom Menace (1999)" are film
    installments, not TV episodes.
    """
    s = name.upper()
    if MULTI_PART_ONLY_RE.search(s):
        return True
    if PART_RE.search(s):
        return False
    if SEASON_CODE_RE.search(s) or SEASON_WORD_RE.search(s) or SEASON_PT_RE.search(s) or COMPLETE_SERIES_RE.search(s):
        return True
    if EPISODE_WORD_RE.search(s):
        # Has a film year -> installment of a film saga, not a TV episode.
        if YEAR_IN_NAME.search(s):
            return False
        return True
    return False


def season_of(name: str):
    """Return the season number if the name indicates one, else None."""
    m = SEASON_CODE_RE.search(name) or SEASON_WORD_RE.search(name) or SEASON_PT_RE.search(name)
    if not m:
        return None
    val = m.group(1) or m.group(2)
    return int(val) if val else None


def series_base_title(name: str) -> str:
    """Extract the base series title (strip season/episode/quality markers)."""
    s = _strip_accents(name)
    s = SEASON_CODE_RE.sub(" ", s)
    s = SEASON_WORD_RE.sub(" ", s)
    s = EPISODE_WORD_RE.sub(" ", s)
    s = COMPLETE_SERIES_RE.sub(" ", s)
    s = TAG_RE.sub(" ", s)
    s = RELEASE_GROUP_RE.sub(" ", s)
    s = YEAR_RE.sub(" ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s.lower())
    return " ".join(s.split())


def clean_title(text: str) -> str:
    """Strip separators and tags, keeping words (used for display/grouping)."""
    s = _strip_accents(text)
    s = TAG_RE.sub(" ", s)
    s = RELEASE_GROUP_RE.sub(" ", s)
    s = YEAR_RE.sub(" ", s)
    s = _collapse_apostrophes(s)
    s = re.sub(r"[^a-z0-9\s]", " ", s.lower())
    return " ".join(s.split())
