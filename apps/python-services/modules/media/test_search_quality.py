#!/usr/bin/env python3
"""Teste de qualidade do motor de busca P2P — 100 queries em 20 categorias."""
import sys
import json
import time
import os
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from media_search_engine import search_media

QUERIES = {
    # ========== FILMES (10 categorias × 5) ==========
    "Ação e Aventura": [
        ("velozes e furiosos", "fast and furious", "Fast & Furious"),
        ("missao impossivel", "mission impossible", "Mission: Impossible"),
        ("mad max", "mad max", "Mad Max"),
        ("john wick", "john wick", "John Wick"),
        ("indiana jones", "indiana jones", "Indiana Jones"),
    ],
    "Ficção Científica": [
        ("interestelar", "interstellar", "Interstellar"),
        ("blade runner", "blade runner", "Blade Runner"),
        ("matrix", "matrix", "The Matrix"),
        ("duna", "dune", "Dune"),
        ("a origem", "inception", "Inception"),
    ],
    "Animação": [
        ("toy story", "toy story", "Toy Story"),
        ("shrek", "shrek", "Shrek"),
        ("frozen", "frozen", "Frozen"),
        ("rei leao", "lion king", "The Lion King"),
        ("divertida mente", "inside out", "Inside Out"),
    ],
    "Terror / Suspense": [
        ("halloween", "halloween", "Halloween"),
        ("scream", "scream", "Scream"),
        ("invocacao do mal", "the conjuring", "The Conjuring"),
        ("it a coisa", "it", "It"),
        ("um lugar silencioso", "a quiet place", "A Quiet Place"),
    ],
    "Drama": [
        ("forrest gump", "forrest gump", "Forrest Gump"),
        ("clube da luta", "fight club", "Fight Club"),
        ("o poderoso chefao", "the godfather", "The Godfather"),
        ("um sonho de liberdade", "shawshank redemption", "The Shawshank Redemption"),
        ("parasita", "parasite", "Parasite"),
    ],
    "Comédia": [
        ("deadpool", "deadpool", "Deadpool"),
        ("se beber nao case", "the hangover", "The Hangover"),
        ("superbad", "superbad", "Superbad"),
        ("as branquelas", "white chicks", "White Chicks"),
        ("ted", "ted", "Ted"),
    ],
    "Clássicos (pré-2000)": [
        ("pulp fiction", "pulp fiction", "Pulp Fiction"),
        ("jurassic park", "jurassic park", "Jurassic Park"),
        ("de volta pro futuro", "back to the future", "Back to the Future"),
        ("exterminador do futuro", "terminator", "The Terminator"),
        ("star wars", "star wars", "Star Wars"),
    ],
    "Super-heróis": [
        ("vingadores", "avengers", "The Avengers"),
        ("homem aranha", "spider-man", "Spider-Man"),
        ("batman", "batman", "Batman"),
        ("pantera negra", "black panther", "Black Panther"),
        ("homem de ferro", "iron man", "Iron Man"),
    ],
    "Documentários": [
        ("cosmos", "cosmos", "Cosmos"),
        ("planeta terra", "planet earth", "Planet Earth"),
        ("free solo", "free solo", "Free Solo"),
        ("o dilema das redes", "the social dilemma", "The Social Dilemma"),
        ("minha professora polvo", "my octopus teacher", "My Octopus Teacher"),
    ],
    "Fantasia": [
        ("harry potter", "harry potter", "Harry Potter"),
        ("senhor dos aneis", "lord of the rings", "The Lord of the Rings"),
        ("avatar", "avatar", "Avatar"),
        ("piratas do caribe", "pirates of the caribbean", "Pirates of the Caribbean"),
        ("cronicas de narnia", "narnia", "The Chronicles of Narnia"),
    ],
    # ========== SÉRIES (10 categorias × 5) ==========
    "Séries — Drama": [
        ("breaking bad", "breaking bad", "Breaking Bad"),
        ("ozark", "ozark", "Ozark"),
        ("succession", "succession", "Succession"),
        ("the crown", "the crown", "The Crown"),
        ("better call saul", "better call saul", "Better Call Saul"),
    ],
    "Séries — Comédia": [
        ("the office", "the office", "The Office"),
        ("friends", "friends", "Friends"),
        ("brooklyn nine nine", "brooklyn 99", "Brooklyn Nine-Nine"),
        ("ted lasso", "ted lasso", "Ted Lasso"),
        ("rick and morty", "rick and morty", "Rick and Morty"),
    ],
    "Séries — Ficção Científica": [
        ("stranger things", "stranger things", "Stranger Things"),
        ("black mirror", "black mirror", "Black Mirror"),
        ("westworld", "westworld", "Westworld"),
        ("the expanse", "the expanse", "The Expanse"),
        ("dark", "dark", "Dark"),
    ],
    "Séries — Animação": [
        ("simpsons", "simpsons", "The Simpsons"),
        ("south park", "south park", "South Park"),
        ("arcane", "arcane", "Arcane"),
        ("avatar a lenda de aang", "avatar the last airbender", "Avatar"),
        ("invincible", "invincible", "Invincible"),
    ],
    "Séries — Crime / Mistério": [
        ("peaky blinders", "peaky blinders", "Peaky Blinders"),
        ("mindhunter", "mindhunter", "Mindhunter"),
        ("true detective", "true detective", "True Detective"),
        ("sherlock", "sherlock", "Sherlock"),
        ("narcos", "narcos", "Narcos"),
    ],
    "Séries — Fantasia": [
        ("game of thrones", "game of thrones", "Game of Thrones"),
        ("the witcher", "the witcher", "The Witcher"),
        ("house of the dragon", "house of the dragon", "House of the Dragon"),
        ("shadow and bone", "shadow and bone", "Shadow and Bone"),
        ("carnival row", "carnival row", "Carnival Row"),
    ],
    "Séries — Terror": [
        ("the walking dead", "the walking dead", "The Walking Dead"),
        ("american horror story", "american horror story", "American Horror Story"),
        ("supernatural", "supernatural", "Supernatural"),
        ("the last of us", "the last of us", "The Last of Us"),
        ("from", "from", "From"),
    ],
    "Séries — Documentais": [
        ("planet earth", "planet earth", "Planet Earth"),
        ("our planet", "our planet", "Our Planet"),
        ("making a murderer", "making a murderer", "Making a Murderer"),
        ("chef's table", "chefs table", "Chef's Table"),
        ("formula 1 drive to survive", "f1 drive to survive", "Formula 1"),
    ],
    "Séries — Ação": [
        ("the mandalorian", "the mandalorian", "The Mandalorian"),
        ("reacher", "reacher", "Reacher"),
        ("jack ryan", "tom clancy jack ryan", "Jack Ryan"),
        ("vikings", "vikings", "Vikings"),
        ("24 horas", "24", "24"),
    ],
    "Séries — Época / Históricas": [
        ("downton abbey", "downton abbey", "Downton Abbey"),
        ("bridgerton", "bridgerton", "Bridgerton"),
        ("band of brothers", "band of brothers", "Band of Brothers"),
        ("chernobyl", "chernobyl", "Chernobyl"),
        ("the borgias", "the borgias", "The Borgias"),
    ],
}


def validate_result(result, query_pt):
    """Valida um resultado individual da busca."""
    checks = {
        "has_title": bool(result.get("title")),
        "has_real_magnet": False,
        "seed_count_real": False,
        "size_from_torrent": False,
        "poster_not_unsplash": False,
        "has_backdrop": bool(result.get("backdropUrl")),
    }

    options = result.get("options", [])
    for opt in options:
        source = opt.get("sourceUrl", "")
        if source.startswith("magnet:?xt=urn:btih:") and "dn=" in source:
            info_hash = source.split("btih:")[1].split("&")[0] if "btih:" in source else ""
            if len(info_hash) == 40 and all(c in "0123456789ABCDEFabcdef" for c in info_hash):
                # Hash real (não é SHA1 do título)
                import hashlib
                fake_hash = hashlib.sha1(f"{query_pt}_4K REMUX".encode()).hexdigest().upper()
                fake_hash2 = hashlib.sha1(f"{query_pt}_4K".encode()).hexdigest().upper()
                if info_hash != fake_hash and info_hash != fake_hash2:
                    checks["has_real_magnet"] = True

        seeds = opt.get("badge", "")
        import re
        seed_match = re.search(r"(\d+)", seeds)
        if seed_match:
            seed_val = int(seed_match.group(1))
            if seed_val not in (1420, 890, 2150):
                checks["seed_count_real"] = True

        size = opt.get("size", "")
        if size and size not in ("22.0 GB", "14.8 GB", "3.2 GB", "54.0 GB", "14.2 GB", "3.9 GB"):
            checks["size_from_torrent"] = True

    poster = result.get("posterUrl", "")
    checks["poster_not_unsplash"] = bool(poster) and "unsplash" not in poster.lower()

    return checks


def run_tests():
    results_by_category = {}
    all_results = []
    total = 0
    hits = 0
    total_time = 0

    print("=" * 72)
    print("TESTE DE QUALIDADE — MOTOR DE BUSCA P2P (100 queries)")
    print("=" * 72)

    for category, queries in QUERIES.items():
        cat_hits = 0
        cat_total = len(queries)
        cat_results = []

        print(f"\n{'─' * 72}")
        print(f"  {category} ({cat_total} queries)")
        print(f"{'─' * 72}")

        for query_pt, query_en, title_expected in queries:
            total += 1
            start = time.time()
            try:
                data = search_media(query_pt)
            except Exception as e:
                data = []
                print(f"  ✗ ERRO: {query_pt} → {e}")

            elapsed_ms = (time.time() - start) * 1000
            total_time += elapsed_ms

            found = len(data) > 0
            has_options = any(len(r.get("options", [])) > 0 for r in data)
            validations = [validate_result(r, query_pt) for r in data]
            has_valid = any(
                v["has_real_magnet"] and v["seed_count_real"] and v["poster_not_unsplash"]
                for v in validations
            )

            status = "✓" if found and has_options else ("△" if found else "✗")
            if found and has_options and has_valid:
                cat_hits += 1
                hits += 1

            result_entry = {
                "query": query_pt,
                "query_en": query_en,
                "expected": title_expected,
                "found": found,
                "result_count": len(data),
                "has_options": has_options,
                "has_valid_torrent": has_valid,
                "response_time_ms": round(elapsed_ms, 1),
                "top_title": data[0].get("title", "") if data else "",
                "top_seeds": data[0].get("options", [{}])[0].get("badge", "") if data else "",
                "validations": validations[0] if validations else None,
            }
            cat_results.append(result_entry)
            all_results.append(result_entry)

            seed_info = result_entry["top_seeds"] if result_entry["has_options"] else ""
            print(f"  {status} {query_pt:30s} → {result_entry['top_title'][:35]:35s} {seed_info:25s} {elapsed_ms:6.0f}ms")

        pct = (cat_hits / cat_total) * 100 if cat_total > 0 else 0
        results_by_category[category] = {
            "total": cat_total,
            "hits": cat_hits,
            "pct": round(pct, 1),
            "results": cat_results,
        }
        bar = "█" * int(pct / 10) + "░" * (10 - int(pct / 10))
        print(f"  [{bar}] {pct:.0f}% ({cat_hits}/{cat_total})")

    # ===== RESUMO =====
    print(f"\n{'=' * 72}")
    print("RESUMO FINAL")
    print(f"{'=' * 72}")

    overall_pct = (hits / total) * 100 if total > 0 else 0
    print(f"  Total de queries:     {total}")
    print(f"  Com resultados:       {hits} ({overall_pct:.1f}%)")
    print(f"  Sem resultados:       {total - hits}")
    print(f"  Tempo médio:          {total_time / total:.0f}ms")

    print(f"\n  Ranking por categoria:")
    print(f"  {'Categoria':38s} {'Hits':>5s}  {'%':>5s}")
    print(f"  {'─' * 50}")

    sorted_cats = sorted(results_by_category.items(), key=lambda x: x[1]["pct"], reverse=True)
    for cat, info in sorted_cats:
        bar = "█" * int(info["pct"] / 10)
        print(f"  {cat:38s} {info['hits']:3d}/{info['total']:<3d} {info['pct']:5.1f}%  {bar}")

    passed = sum(1 for _, i in sorted_cats if i["pct"] >= 60)
    print(f"\n  Categorias ≥ 60%: {passed}/{len(sorted_cats)}")

    # Weak queries
    weak = [r for r in all_results if not r["has_valid_torrent"]]
    if weak:
        print(f"\n  Queries fracas (sem torrent válido — {len(weak)}):")
        for w in weak[:10]:
            print(f"    - {w['query']} ({w['expected']})")

    # ===== SALVAR JSON =====
    report = {
        "summary": {
            "total_queries": total,
            "with_valid_torrents": hits,
            "pct": round(overall_pct, 1),
            "avg_response_time_ms": round(total_time / total, 0),
            "categories_passed": passed,
            "total_categories": len(sorted_cats),
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        },
        "categories": results_by_category,
        "weak_queries": [w["query"] for w in weak],
    }

    report_dir = Path(__file__).resolve().parent.parent.parent.parent / "test-results"
    report_dir.mkdir(parents=True, exist_ok=True)
    report_path = report_dir / "search-quality-report.json"
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"\n  Relatório salvo: {report_path}")

    # ===== VALIDAÇÕES CRÍTICAS =====
    print(f"\n{'─' * 72}")
    print("VALIDAÇÕES CRÍTICAS")
    print(f"{'─' * 72}")

    results_with_fake_data = []
    for r in all_results:
        if r.get("validations"):
            v = r["validations"]
            opts = r.get("found", False)
            if opts and not v.get("has_real_magnet", True):
                results_with_fake_data.append(r["query"])
            if opts and not v.get("seed_count_real", True) and v.get("has_real_magnet", False):
                results_with_fake_data.append(r["query"])

    fake_unique = list(set(results_with_fake_data))
    fake_ok = len(fake_unique) == 0

    print(f"  Magnets com hash real (não SHA1 falso): {'✅ OK' if fake_ok else f'❌ {len(fake_unique)} queries com dados falsos'}")
    if fake_unique:
        for q in fake_unique[:5]:
            print(f"    - {q}")

    unsplash = [r["query"] for r in all_results if r.get("validations") and not r["validations"].get("poster_not_unsplash", True) and r.get("found")]
    print(f"  Posters sem Unsplash genérico: {'✅ OK' if len(unsplash) == 0 else f'❌ {len(unsplash)} com Unsplash'}")

    empty_without_error = sum(1 for r in all_results if not r["found"])
    print(f"  Queries sem resultado (retorno vazio): {empty_without_error} — aceitável para termos genéricos")

    return 0 if fake_ok and passed >= 16 else 1


if __name__ == "__main__":
    sys.exit(run_tests())
