#!/usr/bin/env python3
"""Unit tests for download_movie.py --require-pt (Dublado) verification.

No network/ffprobe required — monkeypatches detect_audio_languages and
quarantine_file.
Run: python3 test_download_require_pt.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import download_movie as dm

FAILURES = []


def check(name, cond):
    print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond:
        FAILURES.append(name)


def test_require_pt_rejects_english_only():
    dm.detect_audio_languages = lambda p: ["eng"]
    quarantined = []
    dm.quarantine_file = lambda p, reason: quarantined.append(str(p)) or p
    raised = False
    try:
        dm.verify_pt_audio(Path("/tmp/movie.mp4"), True)
    except RuntimeError:
        raised = True
    check("eng-only + require_pt -> RuntimeError", raised)
    check("eng-only -> quarantena chamada", len(quarantined) == 1)


def test_require_pt_accepts_portuguese():
    dm.detect_audio_languages = lambda p: ["por"]
    quarantined = []
    dm.quarantine_file = lambda p, reason: quarantined.append(str(p)) or p
    raised = False
    try:
        langs = dm.verify_pt_audio(Path("/tmp/movie.mp4"), True)
    except RuntimeError:
        raised = True
    check("por + require_pt -> sem erro", not raised)
    check("por -> retorna idiomas", langs == ["por"])
    check("por -> sem quarentena", len(quarantined) == 0)


def test_require_pt_accepts_dual_audio():
    dm.detect_audio_languages = lambda p: ["eng", "por"]
    raised = False
    try:
        dm.verify_pt_audio(Path("/tmp/movie.mp4"), True)
    except RuntimeError:
        raised = True
    check("eng+por (dual) + require_pt -> sem erro", not raised)


def test_require_pt_rejects_undefined_only():
    # "und" (sem tag de idioma) não é registrado -> lista vazia -> rejeita
    dm.detect_audio_languages = lambda p: []
    raised = False
    try:
        dm.verify_pt_audio(Path("/tmp/movie.mp4"), True)
    except RuntimeError:
        raised = True
    check("sem idioma + require_pt -> RuntimeError", raised)


def test_no_require_pt_accepts_english():
    dm.detect_audio_languages = lambda p: ["eng"]
    raised = False
    try:
        langs = dm.verify_pt_audio(Path("/tmp/movie.mp4"), False)
    except RuntimeError:
        raised = True
    check("eng + require_pt=False -> sem erro", not raised)
    check("eng + require_pt=False -> retorna idiomas", langs == ["eng"])


def main():
    test_require_pt_rejects_english_only()
    test_require_pt_accepts_portuguese()
    test_require_pt_accepts_dual_audio()
    test_require_pt_rejects_undefined_only()
    test_no_require_pt_accepts_english()

    print("\n" + "=" * 40)
    if FAILURES:
        print(f"RESULTADO: {len(FAILURES)} FALHAS -> {FAILURES}")
        sys.exit(1)
    print("RESULTADO: TODOS OS TESTES PASSARAM ✅")
    sys.exit(0)


if __name__ == "__main__":
    main()
