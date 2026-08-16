#!/usr/bin/env python3
"""Curated real-search diagnostic for the JackIn media engine.

Runs search_media over a set of movies/series (EN, PT, recent, franchises)
and reports whether the engine marks the top result as an exactMatch, the
matchScore, and the audio-type breakdown of the options.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import media_search_engine as m  # noqa: E402

TITLES = [
    ("Interstellar", "movie"),
    ("Oppenheimer", "movie"),
    ("Avatar", "movie"),
    ("Duna: Parte 2", "movie"),
    ("Dune Part Two", "movie"),
    ("Toy Story", "movie"),
    ("Gladiator", "movie"),
    ("The Godfather", "movie"),
    ("Inception", "movie"),
    ("O Planeta do Tesouro", "movie"),
    ("Divertida Mente 2", "movie"),
    ("The Dark Knight", "movie"),
    ("John Wick", "movie"),
    ("Mad Max: Fury Road", "movie"),
    ("Parasite", "movie"),
    ("Avengers: Endgame", "movie"),
    ("Spider-Man: No Way Home", "movie"),
    ("Back to the Future", "movie"),
    ("The Batman", "movie"),
    ("Homem-Aranha", "movie"),
    ("Rick and Morty, Season 9", "series"),
    ("Rick and Morty Season 1", "series"),
    ("The Walking Dead Season 11", "series"),
    ("Breaking Bad Season 1", "series"),
    ("Fallout, Season 1", "series"),
    ("Game of Thrones Season 1", "series"),
    ("Demon Slayer Season 1", "series"),
    ("Disclosure Day", "movie"),
    ("Supergirl", "movie"),
    ("World War II with Tom Hanks, Season 1", "series"),
]


def main():
    stats = {"exact": 0, "approx": 0, "no_source": 0}
    for title, _kind in TITLES:
        r = m.search_media(title)
        if not r:
            stats["no_source"] += 1
            print(f"[NO SOURCE ] {title}")
            continue
        g = r[0]
        if g.get("exactMatch"):
            stats["exact"] += 1
            tag = "EXACT"
        elif g.get("matchScore", 0) >= 0.5:
            stats["approx"] += 1
            tag = "APPROX"
        else:
            stats["no_source"] += 1
            tag = "NO SOURCE"
        types = {}
        for o in g["options"]:
            at = o.get("audioType", "?")
            types[at] = types.get(at, 0) + 1
        print(f"[{tag:9}] {title}")
        print(f"           top: {g['title']!r} | exact {bool(g.get('exactMatch'))} | score {g.get('matchScore')} | opts {len(g['options'])} | audio {types}")

    print("\n=== RESUMO ===")
    for k, v in stats.items():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
