#!/usr/bin/env python3
"""Multi-metric fuzzy similarity between media names.

Combines token Jaccard, sequence similarity and token-containment so that
messy, pattern-less torrent names can still be matched against a query.
"""
import difflib
import re

from normalize import normalize_key

_YEAR_RE = re.compile(r"\b(19\d\d|20\d\d)\b")


def _year_tokens(text: str) -> list:
    return re.findall(_YEAR_RE, text)


def _leading_token(text: str) -> str:
    m = re.search(r"[a-zA-Z0-9]+", text)
    return m.group(0) if m else ""


def _is_year_only(text: str) -> bool:
    """True when the string carries no content besides 4-digit year tokens
    (e.g. "2012" or "2012 2009") — i.e. the year IS the title."""
    return bool(_year_tokens(text)) and _YEAR_RE.sub(" ", text).strip() == ""


def similarity(a: str, b: str) -> float:
    """Similarity in [0, 1]. 1.0 == same core key.

    Character-sequence similarity (`seq`) is only trusted for LONG queries
    (>= 4 tokens). Short titles like "iron man" vs "iron lung" get an inflated
    sequence score (~0.7) even though they are different films — that false
    positive made the engine offer "Iron Lung" for an "Iron Man" search. Short
    queries must rely on real token overlap / containment instead. Long queries
    keep the sequence signal, which is what lets a PT-title torrent match an
    EN-title query ("Shang-Chi and the Legend of the Ten Rings" vs the PT
    "Shang-Chi e a Lenda dos Dez Anéis").
    """
    ka = normalize_key(a)
    kb = normalize_key(b)
    if not ka or not kb:
        # normalize_key strips 4-digit years, so a film titled with a year
        # ("2012", "1941", "1984") collapses to "" — and so do its releases
        # ("2012.2009.1080p.BluRay.x264"). Match only when the QUERY is
        # year-only AND the candidate's LEADING token is that year: so "2012"
        # matches "2012.2009.1080p..." but NOT "The Dark Knight Rises (2012)"
        # (year as release date) nor "Beyond 2012: ..." (year embedded in
        # another title) — which the loose overlap would have matched and used
        # to rename the wrong film during metadata enrichment.
        if _is_year_only(a) and _leading_token(b) in _year_tokens(a):
            return 0.9
        return 0.0
    if ka == kb:
        return 1.0

    a_toks = set(ka.split())
    b_toks = set(kb.split())
    union = a_toks | b_toks
    jaccard = len(a_toks & b_toks) / len(union) if union else 0.0

    shorter, longer = (a_toks, b_toks) if len(a_toks) <= len(b_toks) else (b_toks, a_toks)
    containment = 1.0 if shorter and shorter <= longer else 0.0

    seq = difflib.SequenceMatcher(None, ka, kb).ratio()
    if len(ka.split()) <= 3:
        seq = 0.0

    return max(jaccard, seq, containment * 0.9)


def best_match(query: str, candidates, threshold: float = 0.0):
    """Return the candidate with the highest similarity (or None)."""
    best = None
    best_score = threshold
    for c in candidates:
        s = similarity(query, c)
        if s > best_score:
            best_score = s
            best = c
    return best, best_score
