#!/usr/bin/env python3
"""Unit tests for the resilient JackIn media search engine.

No network required — validates normalization, fuzzy matching, query expansion,
series detection, tier detection, ranking and option building.
Run: python3 test_search_unit.py
"""
import sys
import os
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import normalize as nz  # noqa: E402
import matcher as mt  # noqa: E402
import query_expansion as qe  # noqa: E402
import media_search_engine as m  # noqa: E402

# Network isolation: the WordPress curated source is a real-network fetcher. All
# unit tests mock the search fns, so default the WP hunt to [] (individual tests
# that exercise the WP path override it explicitly).
m.search_wp_sites = lambda _q: []  # noqa: E402

FAILURES = []


def check(name, cond):
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {name}")
    if not cond:
        FAILURES.append(name)


def test_normalize_key():
    check("strips tags+years", nz.normalize_key("The.Matrix.1999.1080p.BluRay.x264") == "the matrix")
    check("strips parens+year", nz.normalize_key("Disclosure Day (2026)") == "disclosure day")
    check("season code -> season N", nz.normalize_key("Rick.and.Morty.S09E01.1080p") == "rick and morty season 9")
    check("season word -> season N", nz.normalize_key("Rick and Morty Season 9") == "rick and morty season 9")
    check("leading zeros dropped", nz.normalize_key("Show S07") == "show season 7")
    check("accents stripped", nz.normalize_key("Avatar: O Caminho da Água") == "avatar o caminho da agua")


def test_series_detection():
    check("SxxExx is series", nz.is_series("Rick.and.Morty.S09E01.1080p"))
    check("Season word is series", nz.is_series("The.Walking.Dead.Season.11.720p"))
    check("Complete Series is series", nz.is_series("Cheers.Complete.Series.DVDRip"))
    check("Episode is series", nz.is_series("Breaking.Bad.Episode.1.720p"))
    check("Part 2 is NOT series", not nz.is_series("Dune.Part.Two.2024.1080p"))
    check("Part 1 is NOT series", not nz.is_series("Avengers.Endgame.Part.1.2019"))
    check("plain movie NOT series", not nz.is_series("Disclosure.Day.2026.1080p"))
    check("season_of S09", nz.season_of("Rick.and.Morty.S09.1080p") == 9)
    check("season_of Season 11", nz.season_of("The.Walking.Dead.Season.11") == 11)
    check("season_of PT 1ª Temporada", nz.season_of("Iron Man 1ª Temporada Completa 1080P") == 1)
    check("season_of PT Temporada 2", nz.season_of("Show Temporada 2 720p") == 2)
    check("PT 1ª Temporada is series", nz.is_series("Iron Man 1ª Temporada Completa 1080P"))
    check("PT Temporada is series", nz.is_series("Show 2 Temporada 720p"))
    check("normalize PT season", "iron man season 1" in nz.normalize_key("Iron Man 1ª Temporada Completa 1080P"))
    check("series_base_title", nz.series_base_title("Rick.and.Morty.S09E01.1080p.WEB-DL") == "rick and morty")


def test_similarity():
    check("exact == 1.0", mt.similarity("Disclosure Day", "Disclosure.Day.2026.1080p.WEB-DL") == 1.0)
    check("season canonical match", mt.similarity("Rick and Morty Season 9", "Rick.and.Morty.S09.1080p") == 1.0)
    check("different movie < 1", mt.similarity("Disclosure Day", "Alien Disclosure Day 2026") < 1.0)
    check("unrelated low", mt.similarity("Disclosure Day", "Toy Story 1995 1080p") < 0.5)


def test_year_titled_films():
    # Filmes cujo título é um ano (2012, 1941, 1984) eram apagados pelo
    # YEAR_RE do normalize_key -> similarity 0.0 -> nenhuma fonte achada.
    check("year-title query matches its release", mt.similarity("2012", "2012.2009.1080p.BluRay.AVC.DTS-HD.MA.5.1-FGT") >= 0.4)
    check("year-title matches YIFY release", mt.similarity("2012", "2012 (2009) 1080p BrRip x264 - 1.7GB - YIFY") >= 0.4)
    check("year-title matches 4K release", mt.similarity("2012", "2012 2009 1080p UHD BluRay DV HDR10 x265 10bit-GeneMige") >= 0.4)
    check("year-title does NOT match other year", mt.similarity("2012", "Inception.2010.1080p.BluRay.x264") < 0.4)
    check("year-title does NOT match film whose year is release date", mt.similarity("2012", "The Dark Knight Rises (2012) 1080p BrRip") < 0.4)
    check("year-title does NOT match embedded-title", mt.similarity("2012", "Beyond 2012: Evolving Perspectives On the Next Age (2009)") < 0.4)
    check("tag query still rejected", mt.similarity("dublado", "2012 2009 1080p BluRay DUBLADO") < 0.4)
    check("norm title key preserves year", m._norm_title_key("2012") == "2012")
    check("parse year-title movie", m.parse_movie_name_and_year("2012.2009.1080p.BluRay.x264-FGT") == ("2012", "2009"))
    check("parse year-title no release year", m.parse_movie_name_and_year("2012.1080p.BluRay.x264") == ("2012", ""))
    check("normal movie parse unchanged", m.parse_movie_name_and_year("The Dark Knight Rises (2012) 1080p") == ("the dark knight rises", "2012"))
    check("year-title group exact match", m.exact_match_for("2012", "2012", "2012", None, "") is True)


def test_query_expansion():
    variants = qe.expand_queries("The Matrix")
    joined = " | ".join(variants).lower()
    check("expansion includes base", "the matrix" in joined)
    check("expansion strips article", "matrix" in joined)
    check("expansion includes quality", "the matrix 4k" in joined and "the matrix 1080p" in joined)
    check("expansion deduped", len(variants) == len(set(variants)))

    s_variants = qe.expand_queries("Rick and Morty Season 9")
    s_joined = " | ".join(s_variants).lower()
    check("series expansion S09", "s09" in s_joined)
    check("series expansion complete", "complete" in s_joined)


def test_quality_tier():
    check("tier REMUX", m.quality_tier("Disclosure.Day.2026.2160p.REMUX") == "REMUX")
    check("tier 4K", m.quality_tier("Disclosure.Day.2026.2160p.WEB-DL") == "4K")
    check("tier 1080P", m.quality_tier("Disclosure.Day.2026.1080p.BluRay.x264") == "1080P")
    check("tier 720P", m.quality_tier("Disclosure.Day.2026.720p") == "720P")
    check("tier WEBRIP", m.quality_tier("Disclosure.Day.2026.WEBRip") == "WEBRIP")
    check("tier OTHER", m.quality_tier("Disclosure Day 2026") == "OTHER")


def test_size_sanity():
    check("sanity 1080p 2GB", m.size_sanity("1080P", 2.0) == 1.0)
    check("sanity 1080p 100MB <1", m.size_sanity("1080P", 0.1) < 1.0)
    check("sanity REMUX 20GB", m.size_sanity("REMUX", 20.0) == 1.0)
    check("sanity zero -> 0", m.size_sanity("1080P", 0.0) == 0.0)


def test_language_and_junk():
    check("blocked language", not m.language_allowed("Movie.2024.SPANISH.1080p"))
    check("dubbed allowed", m.language_allowed("Movie.2024.DUBLADO.1080p"))
    check("english allowed", m.language_allowed("Movie.2024.1080p"))
    check("music junk", m.is_junk("Artist.Album.2024.FLAC"))
    check("ebook junk", m.is_junk("Book.Title.epub"))
    check("sample junk", m.is_junk("Movie.SAMPLE.1080p"))
    check("clean not junk", not m.is_junk("Disclosure.Day.2026.1080p"))


def test_tier_to_option():
    t = {
        "name": "Disclosure.Day.2026.1080p.WEB-DL.x264",
        "seeders": "42",
        "size": str(2 * 1024 ** 3),
        "info_hash": "a" * 40,
    }
    opt = m.tier_to_option(t, "1080P")
    check("option keys", all(k in opt for k in
          ["id", "quality", "badge", "resolution", "bitrate", "size", "audio", "format", "sourceUrl"]))
    check("option magnet", opt["sourceUrl"].startswith("magnet:?xt=urn:btih:"))
    check("option badge", "42" in opt["badge"])
    check("option size 2GB", opt["size"] == "2.0 GB")

    zero_t = {
        "name": "Disclosure.Day.2026.1080p.WEB-DL.x264",
        "seeders": "10",
        "size": "0",
        "info_hash": "b" * 40,
    }
    opt_zero = m.tier_to_option(zero_t, "1080P")
    check("option zero size is empty", opt_zero["size"] == "")


def test_build_options():
    def t(name, seeds, size_gb, h):
        return {"name": name, "seeders": str(seeds), "size": str(int(size_gb * 1024 ** 3)), "info_hash": h}

    torrents = [
        t("Disclosure.Day.2026.REMUX.2160p", 3, 25, "b" * 40),
        t("Disclosure.Day.2026.2160p.WEB-DL", 50, 10, "c" * 40),
        t("Disclosure.Day.2026.1080p.BluRay", 200, 4, "d" * 40),
        t("Disclosure.Day.2026.720p", 90, 1.5, "e" * 40),
        t("Disclosure.Day.2026.WEBRip", 12, 1.0, "f" * 40),
        t("Disclosure.Day.2026", 5, 2.0, "g" * 40),
    ]
    opts = m.build_options(torrents)
    check("max 6 options", len(opts) <= 6)
    check("multiple options", len(opts) >= 3)
    check("one per tier", len({o["quality"] for o in opts}) == len(opts))
    check("REMUX present", any("REMUX" in o["quality"] for o in opts))
    check("1080p present", any("1080p" in o["quality"] for o in opts))


def test_candidate_score():
    def t(seeds, name="Disclosure.Day.2026.1080p.BluRay.x264"):
        return {"name": name, "seeders": str(seeds), "size": str(4 * 1024 ** 3), "info_hash": "z" * 40}

    high = m.candidate_score("Disclosure Day", t(200))
    low = m.candidate_score("Disclosure Day", t(2))
    check("more seeders -> higher", high > low)

    wrong_season = m.candidate_score("Rick and Morty Season 9", t(200, "Rick.and.Morty.S07.1080p"))
    right_season = m.candidate_score("Rick and Morty Season 9", t(30, "Rick.and.Morty.S09.1080p"))
    check("exact season beats wrong season", right_season > wrong_season)


def test_classify_audio():
    check("dublado -> dub", m.classify_audio("Movie.2024.1080p.DUBLADO")["audioType"] == "dub")
    check("dual+pt -> dual", m.classify_audio("Movie.2024.1080p.DUAL.AUDIO.PT-BR")["audioType"] == "dual")
    check("dual -> dual", m.classify_audio("Movie.2024.1080p.DUAL.AUDIO")["audioType"] == "dual")
    check("no tag -> unknown", m.classify_audio("Movie.2024.1080p")["audioType"] == "unknown")
    check("legendado -> hasSubtitles", m.classify_audio("Movie.2024.1080p.LEGENDADO")["hasSubtitles"] is True)
    check("multi -> multi", m.classify_audio("Movie.2024.MULTI.AUDIO")["audioType"] == "multi")

    # PT subtitle detection: a PT-confirmed dub implies PT subs.
    d = m.classify_audio("Movie.2024.1080p.DUBLADO.PT-BR")
    check("dublado -> pt subs", d["hasPtSubtitles"] is True and d["hasSubtitles"] is True)
    # Curated PT "DUAL ÁUDIO" (accented) implies PT subs.
    cd = m.classify_audio("[Dual Áudio] Movie.2024.1080P - limontorrents")
    check("curated dual audio -> pt subs", cd["hasPtSubtitles"] is True)
    # Generic "DUAL AUDIO" (unaccented) does NOT imply PT subs (honest).
    gd = m.classify_audio("Movie.2024.1080p.DUAL.AUDIO")
    check("generic dual -> no pt subs", gd["hasPtSubtitles"] is False)
    # Plain original has no PT subs.
    check("original -> no pt subs", m.classify_audio("Movie.2024.1080p")["hasPtSubtitles"] is False)

    def t(name):
        return {"name": name, "seeders": "20", "size": str(4 * 1024 ** 3), "info_hash": "q" * 40}

    dub = m.candidate_score("Movie", t("Movie.2024.1080p.DUBLADO"), "dub")
    orig = m.candidate_score("Movie", t("Movie.2024.1080p"), "dub")
    check("dub pref boosts dubbed", dub > orig)


def test_build_options_guarantees():
    def t(name, seeds, h):
        return {"name": name, "seeders": str(seeds), "size": str(3 * 1024 ** 3), "info_hash": h}

    torrents = [
        t("Movie.2024.1080p.BluRay.x264", 500, "a" * 40),
        t("Movie.2024.1080p.DUBLADO.PT-BR", 20, "b" * 40),
        t("Movie.2024.1080p.DUAL.AUDIO.PT-BR", 10, "c" * 40),
        t("Movie.2024.1080p.WEB-DL.LEGENDADO", 30, "d" * 40),
        t("Movie.2024.720p", 15, "e" * 40),
    ]
    opts = m.build_options(torrents)
    types = {o["audioType"] for o in opts}
    check("dubbed represented", bool(types & {"dub", "dual", "multi"}))
    check("dual preferred over dub", any(o["audioType"] == "dual" for o in opts))
    check("legendado represented", any(o["hasSubtitles"] for o in opts))
    check("original represented", "unknown" in types)
    check("no duplicate hashes", len({o["id"] for o in opts}) == len(opts))


def test_exact_match_for():
    check("pt title exact (raw)", m.exact_match_for("Duna: Parte 2", "dune parte 2", "duna parte 2", None) is True)
    check("pt translation exact", m.exact_match_for("Divertida Mente 2", "inside out 2", "inside out 2", None) is True)
    check("franchise not exact", m.exact_match_for("Avatar", "avatar", "avatar the way of water", None) is False)
    check("article exact", m.exact_match_for("The Godfather", "the godfather", "the godfather", None) is True)
    check("series exact", m.exact_match_for("Rick and Morty Season 1", "rick and morty season 1", "rick and morty Season 1", 1) is True)
    check("series wrong season", m.exact_match_for("Rick and Morty Season 9", "rick and morty season 9", "rick and morty Season 1", 1) is False)
    check("articles ignored", m.exact_match_for(
        "The Lord of the Rings: The Fellowship of the Ring",
        "the lord of the rings the fellowship of the ring",
        "lord of the rings fellowship of ring", None) is True)
    check("missing the is exact", m.exact_match_for("The Hunger Games", "the hunger games", "hunger games", None) is True)


def test_build_options_best_dubbed_and_order():
    def t(name, seeds, h, size=4):
        return {"name": name, "seeders": str(seeds), "size": str(size * 1024 ** 3), "info_hash": h}

    torrents = [
        t("Movie.2024.2160p.WEB-DL", 1328, "a" * 40, 20),
        t("Movie.2024.1080p.DUAL.AUDIO.PT-BR", 46, "b" * 40),
        t("Movie.2024.1080p.DUAL", 3, "c" * 40),
        t("Movie.2024.1080p", 110, "d" * 40),
    ]
    # build_options receives the pool pre-sorted by candidate_score (as in search_media)
    torrents = sorted(torrents, key=lambda x: m.candidate_score("Movie", x), reverse=True)
    opts = m.build_options(torrents)
    dub_opts = [o for o in opts if o.get("audioType") in ("dual", "dub", "multi")]
    check("best dubbed picked", any("46" in o["badge"] for o in dub_opts))
    check("weak dubbed avoided", not any(o["badge"].startswith("⚡ 3") for o in dub_opts))
    check("PT option leads over 4K original", opts[0].get("ptConfirmed") is True)
    check("4K original still present", any(o.get("tier") == "4K" for o in opts))


def test_meta_hint_skips_itunes_enrichment():
    """When the catalog passes Wikipedia metadata, the engine must reuse it and
    NOT call the iTunes enrichment hop."""
    fake = {
        "name": "Oppenheimer.2023.1080p.BluRay.x264",
        "seeders": "120",
        "size": str(8 * 1024 ** 3),
        "info_hash": "a" * 40,
    }
    m.search_all = lambda _q: [fake]
    m.search_pt = lambda _q: []

    calls = {"itunes": 0}
    original_meta = m._fetch_itunes_metadata

    def spy(*a, **k):
        calls["itunes"] += 1
        return original_meta(*a, **k)

    m._fetch_itunes_metadata = spy
    hint = {
        "title": "Oppenheimer",
        "posterUrl": "https://upload.wikimedia.org/wikipedia/en/4/4a/Oppenheimer_%28film%29.jpg",
        "overview": "A 2023 epic biographical thriller film directed by Christopher Nolan.",
        "genre": "Suspense",
    }
    results = m.search_media("Oppenheimer", "", hint)
    m._fetch_itunes_metadata = original_meta

    check("meta_hint produced a result", len(results) >= 1)
    if results:
        top = results[0]
        check("meta_hint poster reused", top.get("posterUrl") == hint["posterUrl"])
        check("meta_hint overview reused", top.get("overview") == hint["overview"])
        check("meta_hint genre reused", top.get("genre") == hint["genre"])
        check("meta_hint title kept as display", top.get("title") == hint["title"])
        check("meta_hint no distinct original", top.get("originalTitle") == "")
    check("iTunes metadata NOT called with hint", calls["itunes"] == 0)


def test_pt_recall_pass():
    """When the base pool has no confirmed-PT release, the engine hunts tagged
    queries ("TITLE DUBLADO"/"TITLE PT-BR") and surfaces a PT-BR option."""
    base_t = {"name": "Avatar.2009.1080p.BluRay.x264", "seeders": "50", "size": str(4 * 1024 ** 3), "info_hash": "b" * 40}
    pt_t = {"name": "Avatar.2009.1080p.DUBLADO.PT-BR", "seeders": "20", "size": str(4 * 1024 ** 3), "info_hash": "c" * 40}
    calls = []

    def fake_search_all(q):
        calls.append(q.lower())
        if "dublado" in q.lower() or "pt-br" in q.lower():
            return [pt_t]
        return [base_t]

    m.search_all = fake_search_all
    m.search_pt = lambda _q: []
    res = m.search_media("Avatar")
    top = res[0] if res else None
    check("PT pass ran a tagged query", any("dublado" in c or "pt-br" in c for c in calls))
    check("result carries a ptConfirmed option",
          any(o.get("ptConfirmed") for o in (top.get("options", []) if top else [])))
    check("bare DUAL is NOT ptConfirmed",
          m.classify_audio("Movie.2024.1080p.DUAL")["ptConfirmed"] is False)


def test_pt_recall_skipped_when_base_has_pt():
    """If the base pool already has a confirmed-PT release, the extra DUBLADO/PT-BR
    hunt (job at L1027) is skipped. The base query expansion now includes PT-tagged
    variants by default, so 'dublado' may appear in gather calls — that is fine
    (it's the expansion, not the separate hunt). We mock expand_queries here to
    isolate the separate-hunt behaviour."""
    pt_base = {"name": "Movie.2024.1080p.DUBLADO.PT-BR", "seeders": "50", "size": str(4 * 1024 ** 3), "info_hash": "d" * 40}
    calls = []

    def fake_search_all(q):
        calls.append(q.lower())
        return [pt_base]

    def fake_expand(q):
        return [q, q + " 1080p", q + " 4K"]  # no PT tags in expansion

    m.search_all = fake_search_all
    m.search_pt = lambda _q: []
    m.expand_queries = fake_expand
    res = m.search_media("Movie")
    # The extra hunt fires only when the pool carries zero confirmed PT — here it
    # already has a DUBLADO.PT-BR entry, so the extra hunt must NOT add tagged queries.
    check("no tagged hunt when base already has PT", not any("dublado" in c or "pt-br" in c for c in calls))
    check("result present", len(res) >= 1)


def test_pt_recall_uses_br_source_and_strict_mode():
    """The dedicated Brazilian hunt (search_pt) is always consulted and strict
    ptbr mode only lets confirmed-PT releases through rank_torrents."""
    base_t = {"name": "Movie.2024.1080p.BluRay.x264", "seeders": "50", "size": str(4 * 1024 ** 3), "info_hash": "e" * 40}
    pt_t = {"name": "Movie.2024.1080p.DUBLADO.PT-BR", "seeders": "20", "size": str(4 * 1024 ** 3), "info_hash": "f" * 40}
    br_t = {"name": "Movie.2024.720p.DUBLADO", "seeders": "9", "size": str(2 * 1024 ** 3), "info_hash": "g" * 40}

    m.search_all = lambda _q: [base_t]
    m.search_pt = lambda _q: [pt_t, br_t]

    # Normal search: BR hunt supplements the pool.
    res = m.search_media("Movie")
    any_confirmed = any(o.get("ptConfirmed") for r in res for o in r.get("options", []))
    check("normal search surfaces PT via search_pt", any_confirmed)

    # Strict ptbr: rank_torrents must drop the non-PT base release.
    ranked = m.rank_torrents("Movie", [base_t, pt_t], "ptbr")
    check("strict ptbr drops non-PT", all("DUBLADO" in t["name"] for t in ranked))
    check("strict ptbr keeps PT", any("DUBLADO.PT-BR" in t["name"] for t in ranked))


def test_has_pt_subtitles_flag():
    check("legendado -> hasPtSubtitles", m.classify_audio("Movie.2024.1080p.LEGENDADO")["hasPtSubtitles"] is True)
    check("pt-br legendado -> hasPtSubtitles", m.classify_audio("Movie.2024.1080p.PT-BR.LEGENDADO")["hasPtSubtitles"] is True)
    check("dual no sub -> no pt subs", m.classify_audio("Movie.2024.1080p.DUAL.AUDIO")["hasPtSubtitles"] is False)


def test_legendado_ranking_balance():
    """PT subtitles beat generic subtitles at similar seed counts, but an
    overwhelmingly healthier generic release still wins on reliability."""
    def t(name, seeds, h):
        return {"name": name, "seeders": str(seeds), "size": str(4 * 1024 ** 3), "info_hash": h}

    pt_leg = t("Movie.2024.1080p.LEGENDADO.PT-BR", 30, "a" * 40)
    gen_leg = t("Movie.2024.1080p.SUBBED", 50, "b" * 40)
    gen_healthy = t("Movie.2024.1080p.SUBBED", 300, "c" * 40)
    no_subs = t("Movie.2024.1080p", 30, "d" * 40)

    s_pt = m.candidate_score("Movie", pt_leg, "legendado")
    s_gen = m.candidate_score("Movie", gen_leg, "legendado")
    s_healthy = m.candidate_score("Movie", gen_healthy, "legendado")
    s_none = m.candidate_score("Movie", no_subs, "legendado")

    check("PT-leg beats generic at similar seeds", s_pt > s_gen)
    check("healthy generic beats low-seed PT-leg", s_healthy > m.candidate_score("Movie", t("Movie.2024.1080p.LEGENDADO.PT-BR", 2, "e" * 40), "legendado"))
    check("no-subs loses to PT-leg", s_none < s_pt)


def test_ptbr_fallback_pt_unavailable():
    """When strict ptbr finds no confirmed-PT release, the engine falls back to
    the general pool and flags ptUnavailable (so the UI explains "no PT dub
    yet" instead of "no sources at all")."""
    def t(name, seeds, h):
        return {"name": name, "seeders": str(seeds), "size": str(4 * 1024 ** 3), "info_hash": h}

    base = t("New.Movie.2026.1080p.BluRay.x264", 80, "a" * 40)
    es_dual = t("New.Movie.2026.1080p.DUAL.AUDIO", 40, "b" * 40)

    m.search_all = lambda _q: [base, es_dual]
    m.search_pt = lambda _q: [es_dual]

    res = m.search_media("New Movie", "ptbr")
    check("ptbr fallback still returns results", len(res) >= 1)
    if res:
        top = res[0]
        check("ptbr fallback flags ptUnavailable", top.get("ptUnavailable") is True)
        check("ptbr fallback options are NOT ptConfirmed",
              all(not o.get("ptConfirmed") for o in top.get("options", [])))
        check("ptbr fallback keeps options", len(top.get("options", [])) >= 1)


def test_ptbr_no_fallback_when_pt_exists():
    """When a confirmed-PT release exists, strict ptbr must NOT flag ptUnavailable."""
    def t(name, seeds, h):
        return {"name": name, "seeders": str(seeds), "size": str(4 * 1024 ** 3), "info_hash": h}

    pt = t("Movie.2024.1080p.DUBLADO.PT-BR", 20, "a" * 40)
    m.search_all = lambda _q: [pt]
    m.search_pt = lambda _q: [pt]

    res = m.search_media("Movie", "ptbr")
    check("ptbr with PT returns results", len(res) >= 1)
    if res:
        top = res[0]
        check("ptbr with PT not flagged unavailable", top.get("ptUnavailable") is not True)
        check("ptbr with PT has confirmed options",
              any(o.get("ptConfirmed") for o in top.get("options", [])))


def test_pt_unavailable_in_any_mode():
    """The honest flag must appear even in a plain catalog search (audio='any')
    whenever the candidate pool has zero confirmed-PT releases."""
    def t(name, seeds, h):
        return {"name": name, "seeders": str(seeds), "size": str(4 * 1024 ** 3), "info_hash": h}

    # New release with no PT dub anywhere in the pool.
    base = t("New.Movie.2026.1080p.BluRay.x264", 80, "a" * 40)
    es_dual = t("New.Movie.2026.1080p.DUAL.AUDIO", 40, "b" * 40)
    m.search_all = lambda _q: [base, es_dual]
    m.search_pt = lambda _q: [es_dual]

    res = m.search_media("New Movie", "")
    check("any-mode new title returns results", len(res) >= 1)
    if res:
        top = res[0]
        check("any-mode flags ptUnavailable", top.get("ptUnavailable") is True)
        check("any-mode keeps non-PT options", len(top.get("options", [])) >= 1)

    # Established title with a confirmed-PT option must NOT be flagged.
    pt = t("Old.Movie.2019.1080p.DUBLADO.PT-BR", 20, "c" * 40)
    m.search_all = lambda _q: [pt]
    m.search_pt = lambda _q: [pt]
    res2 = m.search_media("Old Movie", "")
    check("any-mode established title returns results", len(res2) >= 1)
    if res2:
        check("any-mode established NOT flagged", res2[0].get("ptUnavailable") is not True)


def test_build_options_no_duplicate_tier_type():
    """Two cards of the same (tier, audioType) must never appear — pass 2 could
    add a second 4K when the first representative was a MULTI pick, producing
    repeated "4K MULTI" rows."""
    def t(name, seeds, h):
        return {"name": name, "seeders": str(seeds), "size": str(30 * 1024 ** 3), "info_hash": h}

    torrents = [
        t("Movie.2026.2160p.WEB-DL.MULTI", 35, "a" * 40),
        t("Movie.2026.2160p.WEB-DL.MULTI", 35, "b" * 40),   # duplicate 4K multi
        t("Movie.2026.2160p.WEB-DL", 20, "c" * 40),
        t("Movie.2026.1080p.BluRay.x264", 90, "d" * 40),
        t("Movie.2026.720p", 40, "e" * 40),
    ]
    opts = m.build_options(torrents)
    keys = [(o.get("tier"), o.get("audioType")) for o in opts]
    check("no duplicate (tier, audioType)", len(keys) == len(set(keys)))
    check("exactly one 4K multi", sum(1 for o in opts if o.get("tier") == "4K" and o.get("audioType") == "multi") == 1)
    # Distinct audioTypes on the same tier are still allowed (original + DUAL).
    def t2(name, seeds, h, size=3):
        return {"name": name, "seeders": str(seeds), "size": str(size * 1024 ** 3), "info_hash": h}

    mixed = [
        t2("Movie.2024.1080p.BluRay.x264", 500, "f" * 40),
        t2("Movie.2024.1080p.DUAL.AUDIO.PT-BR", 20, "g" * 40),
    ]
    mixed = sorted(mixed, key=lambda x: m.candidate_score("Movie", x), reverse=True)
    opts2 = m.build_options(mixed)
    keys2 = {(o.get("tier"), o.get("audioType")) for o in opts2}
    check("1080p original preserved", ("1080P", "unknown") in keys2)
    check("1080p dual preserved", ("1080P", "dual") in keys2)


def test_short_title_variants():
    """Long titles must generate short variants so Brazilian releases that drop
    the subtitle ("Shang-Chi e a Lenda dos Dez Aneis" under "shang-chi") match."""
    from sources_br import short_title_variants
    v = short_title_variants("Shang-Chi and the Legend of the Ten Rings")
    joined = " | ".join(v).lower()
    check("full title variant", "shang-chi and the legend" in joined)
    check("short prefix variant", "shang chi" in joined)
    check("hyphenated variant", "shang-chi" in joined)
    check("no leftover colon", ":" not in " ".join(v))

    v2 = short_title_variants("Oppenheimer")
    check("short title unchanged", "oppenheimer" in " | ".join(v2).lower())


def test_search_pt_filters_franchise_noise():
    """search_pt must drop franchise noise: a hunt for the Mandalorian film must
    NOT return Star Wars IV/Visions, while a real PT release of the requested
    title ("Shang-Chi e a Lenda dos Dez Aneis") is kept even with a PT title."""
    from sources_br import search_pt, _CACHE

    def fake_apibay(q):
        ql = q.lower()
        # Realistic franchise pool: many Star Wars entries, none is the film.
        sw = [
            {"name": f"Star Wars {x} 1080p Dublado Pt Br", "seeders": str(3 + i), "size": "1000", "info_hash": ("a" + str(i))[:40].ljust(40, "0")}
            for i, x in enumerate(["IV", "V", "VI", "I", "II", "III"])
        ]
        sw += [
            {"name": "Star Wars Visions Season 3 S03 2025 1080p DSNP WEBRip Dual Audio", "seeders": "130", "size": "1000", "info_hash": "b" * 40},
            {"name": "Star Wars Andor S01 2022 1080p WEB-DL Dublado Portugues", "seeders": "9", "size": "1000", "info_hash": "c" * 40},
            {"name": "Star Wars: The Mandalorian and Grogu (2026) 1080p Dublado", "seeders": "7", "size": "1000", "info_hash": "d" * 40},
        ]
        sc = [
            {"name": "Shang-Chi e a Lenda dos Dez Aneis (2021) WEB-DL [Dublado Portugues]", "seeders": "1", "size": "1000", "info_hash": "e" * 40},
        ]
        if "shang" in ql:
            return sc
        if "star" in ql or "mandalorian" in ql:
            return sw
        return []

    from sources_br import _apibay as _orig_apibay
    from sources_br import _hunt_1337x as _orig_hunt
    import sources_br
    sources_br._apibay = fake_apibay
    sources_br._hunt_1337x = lambda _q: []
    try:
        _CACHE.clear()
        r_sw = search_pt("Star Wars: The Mandalorian and Grogu")
        names = [t["name"].lower() for t in r_sw]
        check("Mandalorian hunt keeps the right film", any("mandalorian and grogu" in n for n in names))
        check("Mandalorian hunt drops franchise noise", all("visions" not in n and "nova esperanca" not in n and "andor" not in n for n in names))
        _CACHE.clear()
        r_sc = search_pt("Shang-Chi and the Legend of the Ten Rings")
        check("Shang-Chi hunt keeps PT release", any("lenda dos dez aneis" in t["name"].lower() for t in r_sc))
    finally:
        sources_br._apibay = _orig_apibay
        sources_br._hunt_1337x = _orig_hunt


def test_pt_bonus_injected_into_main_group():
    """A confirmed-PT release grouped under its PT title must be injected into
    the exact-match group, so the modal always shows the dubbed option even when
    the EN-title group is full of MULTI/ORIGINAL 4K rows."""
    def t(name, seeds, h, size_gb=3):
        return {"name": name, "seeders": str(seeds), "size": str(int(size_gb * 1024 ** 3)), "info_hash": h}

    # EN group (exact match) with a 60GB MULTI; PT group with the real 1-seed dub.
    en_multi = t("Shang Chi and the Legend of the Ten Rings (2021) 2160p WEB-DL MULTI", 35, "a" * 40, 60)
    en_orig = t("Shang Chi and the Legend of the Ten Rings (2021) 1080p BluRay x264", 53, "b" * 40, 2.4)
    dub = t("Shang-Chi e a Lenda dos Dez Aneis (2021) WEB-DL [Dublado Portugues]", 1, "c" * 40, 1.5)

    m.search_all = lambda _q: [en_multi, en_orig]
    m.search_pt = lambda _q: [dub]
    # The enhanced path always passes the PT title from the LLM interpretation.
    res = m.search_media("Shang-Chi and the Legend of the Ten Rings", "", None, "Shang-Chi e a Lenda dos Dez Anéis")
    check("result present", len(res) >= 1)
    if res:
        top = res[0]
        check("top group is exact-match", top.get("exactMatch") is True)
        pt_opts = [o for o in top.get("options", []) if o.get("ptConfirmed")]
        check("dubbed option present in main group", len(pt_opts) >= 1)
        if pt_opts:
            check("dubbed option labelled PT-BR", "Dublado PT-BR" in pt_opts[0].get("audio", ""))
            check("dubbed option is small (not 60GB)", "60" not in pt_opts[0].get("size", ""))


def test_tier_to_option_float_size():
    """tier_to_option must tolerate a size that arrives as a float string."""
    t = {"name": "Movie.2024.1080p", "seeders": "5", "size": "1610612736.0", "info_hash": "d" * 40}
    opt = m.tier_to_option(t, "1080P")
    check("float size parses", opt.get("size") == "1.5 GB")


def test_query_expansion_accents():
    """PT titles with accents must still translate to the EN map key, so
    "o senhor dos anéis" matches "senhor dos aneis" -> "lord of the rings".
    The leading PT article ("o") is intentionally stripped for a cleaner query."""
    check("accented pt title translates", qe._pt_to_en("o senhor dos anéis") == "the lord of the rings")
    check("plain pt title translates", qe._pt_to_en("o senhor dos aneis") == "the lord of the rings")
    v = qe.expand_queries("o senhor dos anéis")
    check("accented expansion includes EN", any("lord of the rings" in x.lower() for x in v))


def test_audiobook_junk_filter():
    """Audiobook releases must never surface as movies."""
    check("unabridged junk", m.is_junk("Pirates of the Caribbean Read by Simon Vance Unabridged"))
    check("read by junk", m.is_junk("Pirates.of.the.Caribbean.Read.by.Simon.Vance"))
    check("narrated by junk", m.is_junk("Pirates of the Caribbean Narrated by Simon Vance"))
    check("audiobook junk", m.is_junk("Pirates of the Caribbean Audiobook MP3"))
    check("audible junk", m.is_junk("Pirates of the Caribbean [Audible Edition]"))
    check("abridged junk", m.is_junk("Pirates of the Caribbean Abridged 2CD"))
    check("real movie not junk", not m.is_junk("Pirates.of.the.Caribbean.2003.1080p.BluRay.x264"))


def test_movie_pack_filter():
    """Multi-movie packs must not surface as standalone movie groups."""
    check("range pack detected", m.is_movie_pack("Pirates.of.the.Caribbean.1-5.Collection.2003-2017.1080p"))
    check("collection pack detected", m.is_movie_pack("Pirates of the Caribbean 1 5 Collection 1080p"))
    check("boxset detected", m.is_movie_pack("Fast.and.Furious.Boxset.1-8.1080p"))
    check("legit single movie kept", not m.is_movie_pack("The.Collection.2012.1080p"))
    check("sequel kept", not m.is_movie_pack("John.Wick.3.Parabellum.2019.1080p"))
    check("movie boxset dropped", m.is_movie_pack("Pirates.of.the.Caribbean.1.2.&.3.The.Complete.DVD.Boxset") and not m._is_series_pack("Pirates.of.the.Caribbean.1.2.&.3.The.Complete.DVD.Boxset"))
    check("series pack kept", m._is_series_pack("Rick.and.Morty.Complete.Series.S01-S05.1080p"))


def test_apostrophe_normalization():
    """'At World's End' and 'At Worlds End' must collapse to the same key."""
    a = "Pirates.of.the.Caribbean.At.World's.End.2007.1080p"
    b = "Pirates.of.the.Caribbean.At.Worlds.End.2007.1080p"
    check("apostrophe key matches", nz.normalize_key(a) == nz.normalize_key(b) == "pirates of the caribbean at worlds end")
    check("apostrophe clean_title matches", nz.clean_title(a) == nz.clean_title(b))
    c = "Pirates.of.the.Caribbean.Dead.Man's.Chest.2006.1080p"
    d = "Pirates.of.the.Caribbean.Dead.Mans.Chest.2006.1080p"
    check("dead man's variants", nz.normalize_key(c) == nz.normalize_key(d))
    check("similarity ap's vs no-ap's", mt.similarity(a, b) == 1.0)


def test_itunes_rejects_audiobooks():
    """iTunes enrichment must only accept explicit movie kinds."""
    audiobook = {"wrapperType": "track", "kind": "audiobook", "trackName": "Pirates of the Caribbean (Unabridged)", "collectionName": "Pirates of the Caribbean"}
    music = {"wrapperType": "track", "kind": "song", "trackName": "Pirates of the Caribbean Theme", "collectionName": "Soundtrack"}
    movie = {"wrapperType": "track", "kind": "movie", "trackName": "Pirates of the Caribbean: The Curse of the Black Pearl", "collectionName": "Pirates of the Caribbean"}
    movie_unabridged = {"wrapperType": "track", "kind": "movie", "trackName": "Pirates of the Caribbean Read by Simon Vance Unabridged", "collectionName": "Pirates"}
    check("audiobook rejected", not m._is_movie_item(audiobook))
    check("music rejected", not m._is_movie_item(music))
    check("movie accepted", m._is_movie_item(movie))
    check("movie-with-audiobook-title rejected", not m._is_movie_item(movie_unabridged))


def test_tmdb_requires_key():
    """TMDB enrichment is a no-op without a key (never blocks search)."""
    old = os.environ.get("TMDB_API_KEY")
    os.environ["TMDB_API_KEY"] = ""
    try:
        check("no key -> empty", m._tmdb_lookup("Pirates of the Caribbean", "2003") == {})
    finally:
        if old is None:
            os.environ.pop("TMDB_API_KEY", None)
        else:
            os.environ["TMDB_API_KEY"] = old


def test_title_case_display():
    """Group titles must never render raw lowercase."""
    check("title case movie", m._title_case("pirates of the caribbean") == "Pirates of the Caribbean")
    check("title case series", m._title_case("the mandalorian season 1") == "The Mandalorian Season 1")
    check("title case small words", m._title_case("a quiet place day one") == "A Quiet Place Day One")


def test_display_dedup():
    """Rows enriched to the same film must collapse into one (options merged),
    while distinct films that share a title/year differ stay separate."""
    def row(title, year, media_type="movie", opt_id=None):
        return {
            "title": title, "year": year, "mediaType": media_type,
            "options": [{"id": opt_id or title, "sourceUrl": f"magnet:{opt_id or title}"}],
        }

    rows = [
        row("Piratas do Caribe: A Maldição do Pérola Negra", "2003", opt_id="a"),
        row("Piratas do Caribe: A Maldição do Pérola Negra", "2003", opt_id="b"),
        row("Piratas do Caribe: No Fim do Mundo", "2007", opt_id="c"),
    ]
    deduped = m.dedup_by_display(rows)
    check("dupe titles merged", len(deduped) == 2)
    first = deduped[0]
    check("merged options", len(first["options"]) == 2)

    empty_year = [
        row("Piratas do Caribe: A Maldição do Pérola Negra", "", opt_id="a"),
        row("Piratas do Caribe: A Maldição do Pérola Negra", "2003", opt_id="b"),
    ]
    merged = m.dedup_by_display(empty_year)
    check("empty year merged", len(merged) == 1)
    check("year filled from sibling", merged[0]["year"] == "2003")

    same_title_diff_year = [
        row("The Last of Us", "2013", "movie", opt_id="a"),
        row("The Last of Us", "2023", "movie", opt_id="b"),
    ]
    kept = m.dedup_by_display(same_title_diff_year)
    check("distinct years kept", len(kept) == 2)


def test_single_token_relevance_and_silo():
    """Single token queries must anchor the title prefix and not match loose containment in the middle."""
    check(
        "silo rejects Dimension 20 episode title",
        not m._strong_match("silo", "Dimension 20 S28E04 The Silo a Specter and the Student Body")
    )
    check(
        "silo matches The Silo Season 1",
        m._strong_match("silo", "The Silo Season 1 1080p")
    )
    check(
        "silo matches Silo S01E01",
        m._strong_match("silo", "Silo.S01E01.1080p")
    )
    check(
        "avatar matches Avatar The Way of Water",
        m._strong_match("avatar", "Avatar The Way of Water 2022")
    )
    check(
        "series group title does not isolate middle token",
        m._series_group_title("silo", "Dimension 20 S28E04 The Silo a Specter and the Student Body") != "silo"
    )
    check(
        "series group title extracts valid prefix",
        m._series_group_title("silo", "Silo S02 2160p") == "silo"
    )


def test_build_options_never_offers_known_non_pt_as_dubbed():
    """Um release conhecido (via ffprobe) como SEM áudio PT nunca pode ser
    oferecido como opção dublada — mesmo que o nome carregue um marcador
    "DUAL". O fallback de um pedido Dublado deve pular esse release."""
    def t(name, h, seeds=30):
        return {"name": name, "seeders": str(seeds), "size": str(4 * 1024 ** 3), "info_hash": h}

    known_non_pt = "e" * 40
    pt_dub = "d" * 40

    # Conhecimento aprendido: known_non_pt foi verificado por ffprobe e não tem PT.
    m._pt_knowledge = lambda h: ({"pt": False, "langs": ["eng"]} if h == known_non_pt else
                                 {"pt": True, "langs": ["por"]} if h == pt_dub else None)

    torrents = [
        t("Movie.2024.1080p.DUAL.AUDIO", known_non_pt),   # nome ambiguo, mas conhecido sem PT
        t("Movie.2024.1080p.DUBLADO", pt_dub),            # confirmado PT
        t("Movie.2024.1080p", "f" * 40),                  # original
    ]
    opts = m.build_options(torrents)

    dubbed = [o for o in opts if o["ptConfirmed"] or o["audioType"] in ("dual", "dub", "multi")]
    check("dubbed option offered", any(o["ptConfirmed"] for o in dubbed))
    check("known non-PT never offered as dubbed", all(o["sourceUrl"].find(known_non_pt) == -1 for o in dubbed))
    check("known non-PT excluded from options entirely",
          all(o["sourceUrl"].find(known_non_pt) == -1 for o in opts))


def main():
    test_normalize_key()
    test_series_detection()
    test_similarity()
    test_year_titled_films()
    test_query_expansion()
    test_query_expansion_accents()
    test_quality_tier()
    test_size_sanity()
    test_language_and_junk()
    test_classify_audio()
    test_tier_to_option()
    test_build_options()
    test_build_options_guarantees()
    test_build_options_best_dubbed_and_order()
    test_candidate_score()
    test_exact_match_for()
    test_meta_hint_skips_itunes_enrichment()
    test_pt_recall_pass()
    test_pt_recall_skipped_when_base_has_pt()
    test_pt_recall_uses_br_source_and_strict_mode()
    test_has_pt_subtitles_flag()
    test_legendado_ranking_balance()
    test_ptbr_fallback_pt_unavailable()
    test_ptbr_no_fallback_when_pt_exists()
    test_pt_unavailable_in_any_mode()
    test_build_options_no_duplicate_tier_type()
    test_short_title_variants()
    test_search_pt_filters_franchise_noise()
    test_pt_bonus_injected_into_main_group()
    test_tier_to_option_float_size()
    test_audiobook_junk_filter()
    test_movie_pack_filter()
    test_apostrophe_normalization()
    test_itunes_rejects_audiobooks()
    test_tmdb_requires_key()
    test_title_case_display()
    test_display_dedup()
    test_single_token_relevance_and_silo()
    test_build_options_never_offers_known_non_pt_as_dubbed()

    print("\n" + "=" * 40)
    if FAILURES:
        print(f"RESULTADO: {len(FAILURES)} FALHAS -> {FAILURES}")
        sys.exit(1)
    print("RESULTADO: TODOS OS TESTES PASSARAM ✅")
    sys.exit(0)


if __name__ == "__main__":
    main()
