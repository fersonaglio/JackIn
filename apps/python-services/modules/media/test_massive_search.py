#!/usr/bin/env python3
"""Teste massivo simulando buscas reais de usuários — 200 queries."""
import sys
import json
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from media_search_engine import search_media
import hashlib

FAKE_SEEDS = {1420, 890, 2150}
FAKE_SIZES = {"22.0 GB", "14.8 GB", "3.2 GB", "54.0 GB", "14.2 GB", "3.9 GB"}
UNSPLASH = "unsplash"

QUERIES = [
    # ===== 1. BUSCAS EM INGLÊS (40 queries) — mais comum em sites de torrent =====
    ("interstellar", "en", "movie"),
    ("oppenheimer", "en", "movie"),
    ("dune part two", "en", "movie"),
    ("deadpool wolverine", "en", "movie"),
    ("avatar", "en", "movie"),
    ("inception", "en", "movie"),
    ("dark knight", "en", "movie"),
    ("pulp fiction", "en", "movie"),
    ("fight club", "en", "movie"),
    ("godfather", "en", "movie"),
    ("forrest gump", "en", "movie"),
    ("shawshank redemption", "en", "movie"),
    ("gladiator", "en", "movie"),
    ("saving private ryan", "en", "movie"),
    ("braveheart", "en", "movie"),
    ("jurassic park", "en", "movie"),
    ("terminator", "en", "movie"),
    ("alien", "en", "movie"),
    ("blade runner", "en", "movie"),
    ("john wick", "en", "movie"),
    ("mad max", "en", "movie"),
    ("spider man", "en", "movie"),
    ("iron man", "en", "movie"),
    ("avengers", "en", "movie"),
    ("batman", "en", "movie"),
    ("joker", "en", "movie"),
    ("logan", "en", "movie"),
    ("deadpool", "en", "movie"),
    ("wonder woman", "en", "movie"),
    ("fast furious", "en", "movie"),
    ("mission impossible", "en", "movie"),
    ("harry potter", "en", "movie"),
    ("lord of the rings", "en", "movie"),
    ("star wars", "en", "movie"),
    ("transformers", "en", "movie"),
    ("pirates caribbean", "en", "movie"),
    ("james bond", "en", "movie"),
    ("toy story", "en", "movie"),
    ("frozen", "en", "movie"),
    ("shrek", "en", "movie"),

    # ===== 2. BUSCAS EM PORTUGUÊS (30 queries) — usuário brasileiro =====
    ("vingadores", "pt", "movie"),
    ("homem aranha", "pt", "movie"),
    ("velozes e furiosos", "pt", "movie"),
    ("missao impossivel", "pt", "movie"),
    ("senhor dos aneis", "pt", "movie"),
    ("guerra nas estrelas", "pt", "movie"),
    ("harry potter", "pt", "movie"),
    ("piratas do caribe", "pt", "movie"),
    ("de volta pro futuro", "pt", "movie"),
    ("exterminador do futuro", "pt", "movie"),
    ("o poderoso chefao", "pt", "movie"),
    ("clube da luta", "pt", "movie"),
    ("a origem", "pt", "movie"),
    ("interestelar", "pt", "movie"),
    ("duna", "pt", "movie"),
    ("gladiador", "pt", "movie"),
    ("batman cavaleiro das trevas", "pt", "movie"),
    ("pantera negra", "pt", "movie"),
    ("homem de ferro", "pt", "movie"),
    ("capitao america", "pt", "movie"),
    ("doutor estranho", "pt", "movie"),
    ("liga da justica", "pt", "movie"),
    ("mundo jurassico", "pt", "movie"),
    ("madagascar", "pt", "movie"),
    ("toy story", "pt", "movie"),
    ("procurando nemo", "pt", "movie"),
    ("rei leao", "pt", "movie"),
    ("divertida mente", "pt", "movie"),
    ("forrest gump", "pt", "movie"),
    ("matrix", "pt", "movie"),

    # ===== 3. SÉRIES DE TV (40 queries) — extremamente populares em torrents =====
    ("breaking bad", "en", "series"),
    ("game of thrones", "en", "series"),
    ("stranger things", "en", "series"),
    ("the office", "en", "series"),
    ("friends", "en", "series"),
    ("rick and morty", "en", "series"),
    ("south park", "en", "series"),
    ("simpsons", "en", "series"),
    ("family guy", "en", "series"),
    ("black mirror", "en", "series"),
    ("westworld", "en", "series"),
    ("the walking dead", "en", "series"),
    ("better call saul", "en", "series"),
    ("peaky blinders", "en", "series"),
    ("narcos", "en", "series"),
    ("vikings", "en", "series"),
    ("the witcher", "en", "series"),
    ("house of the dragon", "en", "series"),
    ("the last of us", "en", "series"),
    ("the boys", "en", "series"),
    ("suits", "en", "series"),
    ("sherlock", "en", "series"),
    ("true detective", "en", "series"),
    ("dark", "en", "series"),
    ("ozark", "en", "series"),
    ("arcane", "en", "series"),
    ("invincible", "en", "series"),
    ("the mandalorian", "en", "series"),
    ("ted lasso", "en", "series"),
    ("succession", "en", "series"),
    ("supernatural", "en", "series"),
    ("american horror story", "en", "series"),
    ("chernobyl", "en", "series"),
    ("band of brothers", "en", "series"),
    ("brooklyn nine nine", "en", "series"),
    ("the crown", "en", "series"),
    ("downton abbey", "en", "series"),
    ("mindhunter", "en", "series"),
    ("reacher", "en", "series"),
    ("formula 1 drive to survive", "en", "series"),

    # ===== 4. BUSCAS PARCIAIS / COM ERRO (20 queries) =====
    ("avenger", "typo", "movie"),
    ("spiderman", "typo", "movie"),
    ("harry", "partial", "movie"),
    ("matrix", "partial", "movie"),
    ("dune", "partial", "movie"),
    ("bat", "partial", "movie"),
    ("transformer", "typo", "movie"),
    ("gladiator", "partial", "movie"),
    ("jurasic", "typo", "movie"),
    ("terminater", "typo", "movie"),
    ("stranger thing", "typo", "series"),
    ("game of throne", "typo", "series"),
    ("walking dead", "partial", "series"),
    ("break bad", "partial", "series"),
    ("peaky", "partial", "series"),
    ("witcher", "partial", "series"),
    ("mandalorian", "partial", "series"),
    ("rick morty", "partial", "series"),
    ("blinders", "partial", "series"),
    ("chernobil", "typo", "series"),

    # ===== 5. BUSCAS COM ANO (20 queries) =====
    ("dune 2021", "en", "movie"),
    ("matrix 1999", "en", "movie"),
    ("batman 2022", "en", "movie"),
    ("joker 2019", "en", "movie"),
    ("dune 2024", "en", "movie"),
    ("avatar 2009", "en", "movie"),
    ("gladiator 2000", "en", "movie"),
    ("oppenheimer 2023", "en", "movie"),
    ("inception 2010", "en", "movie"),
    ("interstellar 2014", "en", "movie"),
    ("avengers 2012", "en", "movie"),
    ("star wars 1977", "en", "movie"),
    ("alien 1979", "en", "movie"),
    ("terminator 1984", "en", "movie"),
    ("jurassic park 1993", "en", "movie"),
    ("godfather 1972", "en", "movie"),
    ("pulp fiction 1994", "en", "movie"),
    ("shrek 2001", "en", "movie"),
    ("toy story 1995", "en", "movie"),
    ("frozen 2013", "en", "movie"),

    # ===== 6. BUSCAS GENÉRICAS / TERMOS SOLTOS (30 queries) — deve retornar vazio =====
    ("action", "generic", "movie"),
    ("comedy", "generic", "movie"),
    ("horror", "generic", "movie"),
    ("drama", "generic", "movie"),
    ("sci-fi", "generic", "movie"),
    ("best movies 2024", "generic", "movie"),
    ("top films", "generic", "movie"),
    ("new releases", "generic", "movie"),
    ("planeta", "generic", "movie"),
    ("filme", "generic", "movie"),
    ("serie", "generic", "movie"),
    ("guerra", "generic", "movie"),
    ("amor", "generic", "movie"),
    ("aventura", "generic", "movie"),
    ("terror", "generic", "movie"),
    ("comedia", "generic", "movie"),
    ("animacao", "generic", "movie"),
    ("documentario", "generic", "movie"),
    ("lancamentos", "generic", "movie"),
    ("netflix", "generic", "series"),
    ("hbo", "generic", "series"),
    ("disney", "generic", "movie"),
    ("marvel", "generic", "movie"),
    ("dc comics", "generic", "movie"),
    ("pixar", "generic", "movie"),
    ("brasil", "generic", "movie"),
    ("2024 filmes", "generic", "movie"),
    ("series 2024", "generic", "series"),
    ("filmes dublados", "generic", "movie"),
    ("download", "generic", "movie"),

    # ===== 7. ATOR + FILME / DIRETOR (20 queries) =====
    ("leonardo dicaprio", "en", "movie"),
    ("tom cruise", "en", "movie"),
    ("brad pitt", "en", "movie"),
    ("christopher nolan", "en", "movie"),
    ("quentin tarantino", "en", "movie"),
    ("steven spielberg", "en", "movie"),
    ("denzel washington", "en", "movie"),
    ("morgan freeman", "en", "movie"),
    ("robert downey jr", "en", "movie"),
    ("scarlett johansson", "en", "movie"),
    ("tom hanks", "en", "movie"),
    ("margot robbie", "en", "movie"),
    ("keanu reeves", "en", "movie"),
    ("jason statham", "en", "movie"),
    ("vin diesel", "en", "movie"),
    ("the rock", "en", "movie"),
    ("ryan reynolds", "en", "movie"),
    ("hugh jackman", "en", "movie"),
    ("christian bale", "en", "movie"),
    ("joaquin phoenix", "en", "movie"),
]


def validate(query, query_type, results):
    """Validação detalhada dos resultados."""
    info = {
        "query": query,
        "type": query_type,
        "found": False,
        "result_count": 0,
        "has_real_magnet": False,
        "has_fake_seeds": False,
        "has_unsplash": False,
        "title_quality": "no_result",
        "top_title": "",
        "top_seeds": 0,
        "top_size": "",
    }

    if not results:
        return info

    info["found"] = True
    info["result_count"] = len(results)

    first = results[0]
    info["top_title"] = first.get("title", "")
    info["title_quality"] = "valid"

    poster = first.get("posterUrl", "")
    info["has_unsplash"] = UNSPLASH in poster.lower()

    for opt in first.get("options", []):
        source = opt.get("sourceUrl", "")
        if source.startswith("magnet:?xt=urn:btih:"):
            h = source.split("btih:")[1].split("&")[0] if "btih:" in source else ""
            if len(h) == 40 and all(c in "0123456789ABCDEFabcdef" for c in h):
                f1 = hashlib.sha1(f"{query}_4K REMUX".encode()).hexdigest().upper()
                f2 = hashlib.sha1(f"{query}_4K".encode()).hexdigest().upper()
                if h not in (f1, f2):
                    info["has_real_magnet"] = True

        badge = opt.get("badge", "")
        import re
        sm = re.search(r"(\d+)", badge)
        if sm:
            s = int(sm.group(1))
            info["top_seeds"] = max(info["top_seeds"], s)
            if s in FAKE_SEEDS:
                info["has_fake_seeds"] = True

        size = opt.get("size", "")
        if size in FAKE_SIZES:
            info["has_fake_seeds"] = True
        if size and not info["top_size"]:
            info["top_size"] = size

    return info


def run_massive_test():
    results = []
    by_type = {}
    by_query_type = {}
    total_time = 0
    found_count = 0
    real_magnet_count = 0
    fake_data_count = 0
    empty_ok = 0

    print("=" * 80)
    print("TESTE MASSIVO — 200 QUERIES SIMULANDO USUÁRIO REAL")
    print("=" * 80)

    for i, (query, qtype, media_type) in enumerate(QUERIES):
        start = time.time()
        try:
            data = search_media(query)
        except Exception as e:
            data = []
        elapsed = (time.time() - start) * 1000
        total_time += elapsed

        info = validate(query, qtype, data)
        info["response_ms"] = round(elapsed, 1)
        results.append(info)

        if info["found"]:
            found_count += 1
            if info["has_real_magnet"]:
                real_magnet_count += 1
            if info["has_fake_seeds"] and not info["has_real_magnet"]:
                fake_data_count += 1

        # Contagem por tipo
        if qtype not in by_type:
            by_type[qtype] = {"total": 0, "found": 0, "real": 0}
        by_type[qtype]["total"] += 1
        if info["found"]:
            by_type[qtype]["found"] += 1
            if info["has_real_magnet"]:
                by_type[qtype]["real"] += 1

        if media_type not in by_query_type:
            by_query_type[media_type] = {"total": 0, "found": 0, "real": 0}
        by_query_type[media_type]["total"] += 1
        if info["found"]:
            by_query_type[media_type]["found"] += 1
            if info["has_real_magnet"]:
                by_query_type[media_type]["real"] += 1

        # Status rápido
        status = "✓" if info["has_real_magnet"] else ("△" if info["found"] else ("·" if qtype == "generic" else "✗"))
        pct = (i + 1) / len(QUERIES) * 100
        print(f"  [{pct:3.0f}%] {status} {query:35s} → {info['top_title'][:30]:30s} s={info['top_seeds']:>5d} {elapsed:5.0f}ms")

    print(f"\n{'=' * 80}")
    print("RESUMO — 200 QUERIES")
    print(f"{'=' * 80}")
    print(f"  Total:              {len(results)}")
    print(f"  Encontrados:        {found_count} ({found_count/len(results)*100:.1f}%)")
    print(f"  Magnet real:        {real_magnet_count} ({real_magnet_count/len(results)*100:.1f}%)")
    print(f"  Dados falsos:       {fake_data_count}")
    print(f"  Tempo médio:        {total_time/len(results):.0f}ms")

    print(f"\n  POR TIPO DE QUERY:")
    print(f"  {'Tipo':20s} {'Total':>5s} {'Achou':>5s} {'Real':>5s} {'%':>6s}")
    for t, s in sorted(by_type.items(), key=lambda x: x[1]["found"] / max(x[1]["total"], 1), reverse=True):
        p = s["found"] / s["total"] * 100
        print(f"  {t:20s} {s['total']:5d} {s['found']:5d} {s['real']:5d} {p:5.1f}%")

    print(f"\n  POR MÍDIA:")
    for t, s in sorted(by_query_type.items(), key=lambda x: x[1]["found"] / max(x[1]["total"], 1), reverse=True):
        p = s["found"] / s["total"] * 100
        print(f"  {t:20s} {s['total']:5d} {s['found']:5d} {s['real']:5d} {p:5.1f}%")

    # Queries genéricas que deveriam retornar vazio
    generic_ok = sum(1 for r in results if r["type"] == "generic" and not r["found"])
    generic_total = sum(1 for r in results if r["type"] == "generic")
    if generic_total > 0:
        print(f"\n  GENÉRICAS: {generic_ok}/{generic_total} retornaram vazio corretamente")

    # Queries com dados falsos
    fakes = [r for r in results if r["has_fake_seeds"] and not r["has_real_magnet"]]
    if fakes:
        print(f"\n  QUERIES COM DADOS FALSOS ({len(fakes)}):")
        for f in fakes:
            print(f"    - {f['query']:30s} → seeds={f['top_seeds']} title={f['top_title']}")

    # TOP 10 mais rápidos / lentos
    sorted_by_time = sorted(results, key=lambda r: r["response_ms"])
    print(f"\n  TOP 5 MAIS RÁPIDOS:")
    for r in sorted_by_time[:5]:
        print(f"    {r['response_ms']:5.0f}ms  {r['query']}")

    print(f"\n  TOP 5 MAIS LENTOS:")
    for r in sorted_by_time[-5:]:
        print(f"    {r['response_ms']:5.0f}ms  {r['query']}")

    # Salvar JSON completo
    report = {
        "summary": {
            "total": len(results),
            "found_total": found_count,
            "pct_found": round(found_count / len(results) * 100, 1),
            "real_magnets": real_magnet_count,
            "fake_data": fake_data_count,
            "avg_ms": round(total_time / len(results), 0),
            "by_type": {k: {"total": v["total"], "found": v["found"], "real": v["real"],
                            "pct": round(v["found"] / v["total"] * 100, 1)} for k, v in by_type.items()},
        },
        "results": results,
    }

    report_dir = Path(__file__).resolve().parent.parent.parent.parent / "test-results"
    report_dir.mkdir(parents=True, exist_ok=True)
    path = report_dir / "massive-search-report.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"\n  Relatório completo: {path}")

    return results


if __name__ == "__main__":
    run_massive_test()
