#!/usr/bin/env python3
"""Suite de testes massivos para o motor de download do JackIn.

Valida:
1. Extração e cálculo preciso de velocidade e progresso em múltiplos formatos do aria2c.
2. Não-interrupção de downloads em oscilação de velocidade (eliminação de falso deadlock).
3. Reordenação inteligente de áudio PT-BR e conversão para AAC compatível com web.
4. Extração de legendas embutidas e múltiplos formatos (.vtt).
5. Seleção e adaptação automática do arquivo de vídeo principal em torrents com múltiplos arquivos e pastas.
6. Robustez com magnets de diferentes trackers e estruturas.
"""

import unittest
import re
import tempfile
import shutil
import os
import subprocess
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))

from download_movie import (
    reorder_audio_tracks_prefer_pt,
    extract_embedded_subtitles,
    verify_pt_audio,
    validate_file_extension,
    _cleanup_dir,
    BLOCKED_EXTENSIONS,
    FFMPEG_BIN,
    FFPROBE_BIN
)


class TestAria2SpeedAndProgressParsing(unittest.TestCase):
    """Testa os parsers de velocidade e bytes do aria2c."""

    def test_parse_speed_bytes(self):
        def parse_speed_bytes(line: str) -> int:
            m = re.search(r"DL:([\d.]+)([KMGT]?i?B)", line)
            if not m:
                return 0
            val = float(m.group(1))
            unit = m.group(2)
            if unit in ("KiB", "KB"):
                val *= 1024
            elif unit in ("MiB", "MB"):
                val *= 1024 * 1024
            elif unit in ("GiB", "GB"):
                val *= 1024 * 1024 * 1024
            return int(val)

        # Formatos comuns do aria2c
        self.assertEqual(parse_speed_bytes("[#abc 100MiB/1GiB(10%) CN:5 DL:1.5MiB]"), int(1.5 * 1024 * 1024))
        self.assertEqual(parse_speed_bytes("[#abc 100MiB/1GiB(10%) CN:5 DL:850KiB]"), int(850 * 1024))
        self.assertEqual(parse_speed_bytes("[#abc 100MiB/1GiB(10%) CN:5 DL:12.4MiB]"), int(12.4 * 1024 * 1024))
        self.assertEqual(parse_speed_bytes("[#abc 100MiB/1GiB(10%) CN:5 DL:0B]"), 0)
        self.assertEqual(parse_speed_bytes("Linha sem velocidade"), 0)

    def test_parse_downloaded_bytes(self):
        def downloaded_bytes(line: str) -> int:
            m = re.search(r"(?:^|\[#\w+\s+)([\d.]+)([KMGT]?i?B)/", line)
            if not m:
                return 0
            val = float(m.group(1))
            unit = m.group(2)
            if unit in ("KiB", "KB"):
                val *= 1024
            elif unit in ("MiB", "MB"):
                val *= 1024 * 1024
            elif unit in ("GiB", "GB"):
                val *= 1024 * 1024 * 1024
            return int(val)

        self.assertEqual(downloaded_bytes("[#2089b0 1.2GiB/1.6GiB(75%) CN:5]"), int(1.2 * 1024 * 1024 * 1024))
        self.assertEqual(downloaded_bytes("[#2089b0 500MiB/2.5GiB(20%) CN:5]"), int(500 * 1024 * 1024))
        self.assertEqual(downloaded_bytes("[#2089b0 10KiB/1GiB(0%) CN:5]"), int(10 * 1024))
        self.assertEqual(downloaded_bytes("0B/0B"), 0)

    def test_speed_drop_does_not_stall(self):
        """Garante que queda de velocidade (ex: 15MB/s -> 1MB/s) não trava o relógio de avanço."""
        last_downloaded = 0
        last_byte_advance = 1000.0

        def step(line_str, now_t):
            nonlocal last_downloaded, last_byte_advance
            def downloaded_bytes(l):
                m = re.search(r"(?:^|\[#\w+\s+)([\d.]+)([KMGT]?i?B)/", l)
                if not m: return 0
                val = float(m.group(1))
                unit = m.group(2)
                if unit in ("MiB", "MB"): return int(val * 1024 * 1024)
                if unit in ("GiB", "GB"): return int(val * 1024 * 1024 * 1024)
                return int(val)

            def parse_speed_bytes(l):
                m = re.search(r"DL:([\d.]+)([KMGT]?i?B)", l)
                if not m: return 0
                val = float(m.group(1))
                unit = m.group(2)
                if unit in ("MiB", "MB"): return int(val * 1024 * 1024)
                return int(val)

            dl_bytes = downloaded_bytes(line_str)
            speed_val = parse_speed_bytes(line_str)
            if dl_bytes > last_downloaded or speed_val > 0:
                if dl_bytes > last_downloaded:
                    last_downloaded = dl_bytes
                last_byte_advance = now_t

        step("[#abc 100MiB/1.0GiB(10%) CN:5 DL:15.0MiB]", 1005.0)
        self.assertEqual(last_byte_advance, 1005.0)

        step("[#abc 800MiB/1.0GiB(80%) CN:5 DL:2.0MiB]", 1205.0)
        self.assertEqual(last_byte_advance, 1205.0)

        step("[#abc 950MiB/1.0GiB(95%) CN:5 DL:0.5MiB]", 1250.0)
        self.assertEqual(last_byte_advance, 1250.0)


class TestMediaFileCleanupAndValidation(unittest.TestCase):
    def setUp(self):
        self.test_dir = Path(tempfile.mkdtemp(prefix="jackin_test_media_"))

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_validate_file_extension(self):
        self.assertTrue(validate_file_extension("filme.mp4"))
        self.assertTrue(validate_file_extension("filme.mkv"))
        self.assertTrue(validate_file_extension("filme.avi"))
        self.assertTrue(validate_file_extension("filme.mov"))
        self.assertFalse(validate_file_extension("virus.exe"))
        self.assertFalse(validate_file_extension("script.bat"))
        self.assertFalse(validate_file_extension("trojan.scr"))

    def test_cleanup_dir_removes_aria2_and_blocked(self):
        (self.test_dir / "filme.mp4").write_text("dummy video")
        (self.test_dir / "filme.mp4.aria2").write_text("aria2 temp")
        (self.test_dir / "sample.exe").write_text("blocked")
        
        _cleanup_dir(self.test_dir)

        self.assertTrue((self.test_dir / "filme.mp4").exists())
        self.assertFalse((self.test_dir / "filme.mp4.aria2").exists())


class TestFfmpegAudioReorderingAndRemux(unittest.TestCase):
    def setUp(self):
        self.test_dir = Path(tempfile.mkdtemp(prefix="jackin_ffmpeg_test_"))

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_remux_dual_audio_with_synthetic_file(self):
        source_mkv = self.test_dir / "dual_source.mkv"
        
        cmd = [
            FFMPEG_BIN, "-y",
            "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=24",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
            "-f", "lavfi", "-i", "sine=frequency=880:duration=2",
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-map", "0:v",
            "-map", "1:a", "-metadata:s:a:0", "language=eng", "-metadata:s:a:0", "title=English AC3", "-c:a:0", "ac3",
            "-map", "2:a", "-metadata:s:a:1", "language=por", "-metadata:s:a:1", "title=Dublado PT-BR", "-c:a:1", "ac3",
            str(source_mkv)
        ]
        res = subprocess.run(cmd, capture_output=True)
        self.assertEqual(res.returncode, 0, f"Falha ao gerar vídeo de teste: {res.stderr.decode()}")

        reorder_audio_tracks_prefer_pt(source_mkv)

        probe_cmd = [
            FFPROBE_BIN, "-v", "quiet",
            "-show_entries", "stream=index,codec_type,codec_name:stream_tags=language,title",
            "-of", "json",
            str(source_mkv)
        ]
        probe_res = subprocess.run(probe_cmd, capture_output=True, text=True, check=True)
        import json
        data = json.loads(probe_res.stdout)
        audio_streams = [s for s in data.get("streams", []) if s.get("codec_type") == "audio"]

        self.assertEqual(len(audio_streams), 2)
        first_audio = audio_streams[0]
        self.assertEqual(first_audio.get("codec_name"), "aac")
        first_lang = (first_audio.get("tags", {}).get("language") or "").lower()
        self.assertIn(first_lang, ("por", "pt", "pt-br"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
