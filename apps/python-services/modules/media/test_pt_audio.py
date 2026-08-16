#!/usr/bin/env python3
"""Comprehensive PT-BR (dub/legendado) availability test for the search engine.

Searches popular films with the UI default (no audio pref) and reports, per
result, how many options carry: ptConfirmed (dub), legendado (PT subs),
dual/multi audio, or none. Highlights queries where NO PT option surfaced.
"""
import sys, time, json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from media_search_engine import search_media

QUERIES = [
    "avatar", "duna", "joker", "interstellar", "matrix", "inception",
    "titanic", "oppenheimer", "barbie", "top gun", "gladiador",
    "jurassic world", "thor", "aquaman", "spider-man no way home",
]

def analyze():
    report = []
    for q in QUERIES:
        t0 = time.time()
        try:
            res = search_media(q)  # UI default: no audio pref
        except Exception as e:
            print(f"  ERR {q}: {e}")
            continue
        elapsed = round(time.time() - t0, 1)

        row = {"query": q, "results": len(res), "elapsed": elapsed, "pt_status": "?"}
        best = None
        for r in res:
            opts = r.get("options", [])
            n_pt = sum(1 for o in opts if o.get("ptConfirmed"))
            n_leg = sum(1 for o in opts if o.get("hasPtSubtitles"))
            n_dual = sum(1 for o in opts if o.get("audioType") in ("dual", "multi"))
            n_unk = sum(1 for o in opts if o.get("audioType") == "unknown")
            if best is None or (n_pt + n_leg + n_dual) > (best["pt"] + best["leg"] + best["dual"]):
                best = {"title": r.get("title", ""), "opts": len(opts), "pt": n_pt, "leg": n_leg, "dual": n_dual, "unk": n_unk}

        if best is None:
            row["pt_status"] = "NO_RESULTS"
        elif best["pt"] > 0:
            row["pt_status"] = "HAS_DUB"
        elif best["leg"] > 0:
            row["pt_status"] = "HAS_LEG_ONLY"
        elif best["dual"] > 0:
            row["pt_status"] = "HAS_DUAL_ONLY"
        else:
            row["pt_status"] = "NO_PT"
        row["best"] = best
        report.append(row)

        print(f"{'✓' if row['pt_status'] in ('HAS_DUB','HAS_LEG_ONLY','HAS_DUAL_ONLY') else '✗'} {q:28s} {row['pt_status']:16s} {row['results']:2d} res {elapsed:5.1f}s  {best['title'][:34] if best else ''}")
        if best:
            print(f"     opts={best['opts']} dub={best['pt']} leg={best['leg']} dual={best['dual']} orig={best['unk']}")

    print("\n=== SUMMARY ===")
    n = len(report)
    has_pt = sum(1 for r in report if r["pt_status"] in ("HAS_DUB", "HAS_LEG_ONLY", "HAS_DUAL_ONLY"))
    no_pt = sum(1 for r in report if r["pt_status"] in ("NO_PT", "NO_RESULTS"))
    print(f"Total: {n} | Com alguma opção PT (dub/leg/dual): {has_pt} | Sem PT: {no_pt}")
    print("Sem PT:", [r["query"] for r in report if r["pt_status"] in ("NO_PT", "NO_RESULTS")])
    json.dump(report, open("/tmp/pt_audio_test.json", "w"), ensure_ascii=False, indent=1)

if __name__ == "__main__":
    analyze()
