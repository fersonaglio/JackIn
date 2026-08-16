#!/usr/bin/env python3
"""Query variant generator.

Generates multiple search strings for a single title so the engine tries
several phrasings (torrents don't follow a pattern). Variants are ordered by
confidence and deduplicated by their normalized key.
"""
import re
import unicodedata

from normalize import season_of
from search_data import TRANSLATIONS, REVERSE_TRANSLATIONS, COMPOUND_TRANSLATIONS


def _fold(text: str) -> str:
    """Lowercase and strip accents so "senhor dos anéis" matches the map key
    "senhor dos aneis"."""
    return unicodedata.normalize("NFD", text).encode("ascii", "ignore").decode("ascii").lower()


def _pt_to_en(title: str) -> str:
    """Translate Portuguese movie titles to English using known mappings.

    Applies compound translations first (full phrases), then word-level
    translations. Longest keys match first to avoid "duna" capturing
    "duna parte 2". Multiple translations are applied iteratively so
    "senhor dos aneis a sociedade do anel" becomes "The Lord of the Rings The Fellowship of the Ring".
    """
    low = title.lower()
    folded = _fold(title)

    # Step 1: full match — the entire query (after folding) matches a compound key
    for pt, en in COMPOUND_TRANSLATIONS.items():
        if not en:
            continue
        if _fold(pt) == folded:
            return en

    # Step 2: iterative replacement. Start with the original (preserving case)
    # and replace PT phrases with EN equivalents, longest key first.
    # Re-fold after each replacement so subsequent matches see the new text.
    result = low
    changed = True
    max_iter = 10

    # Merge all translations: compound first, then word-level
    all_pt_en: list[tuple[str, str]] = []
    for pt, en in COMPOUND_TRANSLATIONS.items():
        if en:
            all_pt_en.append((pt, en))
    for pt, en in TRANSLATIONS.items():
        all_pt_en.append((pt, en))
    # Sort: longest key first
    all_pt_en.sort(key=lambda x: -len(x[0]))

    for _ in range(max_iter):
        if not changed:
            break
        changed = False
        result_folded = _fold(result)
        for pt, en in all_pt_en:
            pt_folded = _fold(pt)
            idx = result_folded.find(pt_folded)
            if idx >= 0:
                # Replace the PT phrase with the EN equivalent
                result = result[:idx] + en + result[idx + len(pt):]
                changed = True
                break  # restart scan after each replacement

    # Clean up: collapse whitespace, strip leading PT articles
    result = " ".join(result.split())
    result = re.sub(r"^(o|a|os|as)\s+", "", result, flags=re.I).strip()
    return result if result != low else title


def _en_to_pt(title: str) -> str:
    low = title.lower()
    folded = _fold(title)
    sorted_keys = sorted(REVERSE_TRANSLATIONS.keys(), key=len, reverse=True)
    for en in sorted_keys:
        en_folded = _fold(en)
        if en_folded in folded:
            pt = REVERSE_TRANSLATIONS[en]
            return low.replace(en, pt) if en in low else folded.replace(en, pt)
    return title


def expand_queries(title: str) -> list:
    """Return an ordered, deduped list of query variants for a title."""
    base = " ".join(title.split())
    if not base:
        return []

    variants = [base]

    # Translation (pt -> en) if a known term appears
    translated = _pt_to_en(base)
    if translated != base:
        variants.append(translated)
    rev = _en_to_pt(base)
    if rev != base:
        variants.append(rev)

    # Franchise-only head (split on colon/dash) — when the subtitle isn't
    # translatable, the bare franchise name still matches torrents.
    for sep in (":", " - ", "- "):
        if sep in base:
            head = base.split(sep)[0].strip()
            if head and head.lower() != base.lower():
                head_en = _pt_to_en(head)
                if head_en != head and head_en.lower() not in {v.lower() for v in variants}:
                    variants.append(head_en)
                if head not in {v.lower() for v in variants}:
                    variants.append(head)
            break

    # Without leading article
    stripped = re.sub(r"^(the|a|an|o|a|el|la|los|las|un|una)\s+", "", base, flags=re.I)
    if stripped and stripped.lower() != base.lower():
        variants.append(stripped)

    # Split year from the base
    ym = re.search(r"\b(19\d\d|20\d\d)\b", base)
    if ym:
        no_year = base[: ym.start()].strip(" ._-()")
        if no_year:
            variants.append(no_year)
            variants.append(no_year + " " + ym.group(1))
    else:
        variants.append(base + " 2025")

    # Quality-tagged phrasings
    variants.append(base + " 4K")
    variants.append(base + " 2160p")
    variants.append(base + " 1080p")
    variants.append(base + " 720p")
    variants.append(base + " WEB-DL")
    variants.append(base + " BluRay")

    # Editions
    variants.append(base + " extended")
    variants.append(base + " uncut")
    variants.append(base + " director's cut")

    # Series-aware phrasings
    n = season_of(base)
    if n is not None:
        variants.append(re.sub(r"\bS\d{1,2}(?:E\d{1,3})?\b", f"S{n:02d}", base, flags=re.I))
        variants.append(re.sub(r"\bSEASON\s*[-:.]?\s*\d{1,2}\b", f"S{n:02d}", base, flags=re.I))
        variants.append(re.sub(r"\bSEASON\s*[-:.]?\s*\d{1,2}\b", f"s{n}", base, flags=re.I))
        variants.append(base + " complete")
        variants.append(base + " complete series")
    else:
        variants.append(base + " complete")
        variants.append(base + " season 1")

    # PT-BR tagged variants — include dubs/subs from engine start so the
    # initial search_all pass catches Brazilian releases without relying
    # solely on the separate recall hunt.
    variants.append(base + " DUBLADO")
    variants.append(base + " LEGENDADO")
    variants.append(base + " DUAL AUDIO")
    variants.append(base + " PT-BR")

    # Dedup preserving order (light key: case + whitespace only, keeps quality variants)
    seen = set()
    out = []
    for v in variants:
        k = " ".join(v.lower().split())
        if k and k not in seen:
            seen.add(k)
            out.append(v)
    return out
