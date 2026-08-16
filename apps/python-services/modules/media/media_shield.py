#!/usr/bin/env python3
"""Escudo de segurança compartilhado para todas as entradas de mídia do JackIn.

Reutilizado por download_movie.py, download.py e import_media.py: whitelist de
extensões, inspeção fail-closed via ffprobe e quarentena em vez de deleção.
"""
import json
import subprocess
import sys
from pathlib import Path

from config import FFPROBE_BIN

# Whitelist of strictly safe video container extensions
ALLOWED_EXTENSIONS = {".mp4", ".mkv", ".webm", ".mov", ".avi", ".m4v", ".ts", ".m2ts"}

# Blacklist of executable / dangerous extension patterns
BLOCKED_EXTENSIONS = {
    ".exe", ".bat", ".cmd", ".vbs", ".scr", ".js", ".jse", ".wsf", ".wsh",
    ".ps1", ".msi", ".jar", ".zip", ".rar", ".7z", ".iso", ".dmg", ".pkg"
}


def validate_file_extension(filename: str) -> bool:
    ext = Path(filename).suffix.lower()
    if ext in BLOCKED_EXTENSIONS:
        return False
    return ext in ALLOWED_EXTENSIONS


def inspect_video_stream(file_path: Path) -> dict | None:
    """Camada 2: sondagem de segurança via ffprobe (fail-closed).

    Garante vídeo + áudio (≥ estéreo) decodificáveis. Retorna None se o arquivo
    não for uma mídia válida — quem chama deve tratar como rejeição.
    """
    if not file_path.exists() or file_path.stat().st_size < 1000:
        return None

    try:
        cmd = [
            FFPROBE_BIN, "-v", "error",
            "-print_format", "json",
            "-show_format", "-show_streams",
            str(file_path)
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, check=False, timeout=60)
        if res.returncode != 0:
            raise RuntimeError(f"ffprobe exit={res.returncode} stderr={res.stderr[:500]}")
        data = json.loads(res.stdout)

        streams = data.get("streams", [])
        has_video = any(s.get("codec_type") == "video" for s in streams)
        audio_streams = [s for s in streams if s.get("codec_type") == "audio"]
        has_audio = len(audio_streams) > 0
        max_channels = max((int(s.get("channels", 0) or 0) for s in audio_streams), default=0)
        has_acceptable_audio = max_channels >= 2

        format_info = data.get("format", {})
        duration = float(format_info.get("duration", 0))

        if not has_video or not has_audio or not has_acceptable_audio:
            reason = "sem vídeo" if not has_video else ("sem áudio" if not has_audio else f"áudio mono (canais={max_channels})")
            print(f"SECURITY CHECK REJECTED: {reason} em {file_path.name} (path: {file_path})", file=sys.stderr)
            return None

        return {
            "has_video": has_video,
            "has_audio": has_audio,
            "max_channels": max_channels,
            "duration": duration,
            "size_bytes": file_path.stat().st_size
        }
    except Exception as e:
        # FAIL-CLOSED: arquivo que o ffprobe não consegue nem parsear não é
        # um vídeo válido (ex.: torrent interrompido cheio de zeros).
        print(f"SECURITY CHECK REJECTED: FFprobe falhou em {file_path.name} (path: {file_path}): {e}", file=sys.stderr)
        return None


def quarantine_file(file_path: Path, reason: str) -> Path | None:
    """Move um arquivo reprovado para .quarantine em vez de deletá-lo."""
    if not file_path.exists():
        return None
    quarantine = file_path.with_suffix(file_path.suffix + ".quarantine")
    try:
        file_path.rename(quarantine)
        print(f"[JackIn Shield] QUARENTENA: {file_path.name} -> {quarantine.name} (motivo: {reason})", file=sys.stderr)
        return quarantine
    except OSError as q_err:
        print(f"[JackIn Shield] QUARENTENA falhou (rename {file_path.name} -> {quarantine.name}): {q_err}. Deletando como fallback.", file=sys.stderr)
        try:
            file_path.unlink()
        except OSError:
            pass
        return None


def shield_file(file_path: Path, reason_prefix: str = "arquivo importado") -> dict | None:
    """Valida extensão + ffprobe de um arquivo já presente no disco.

    Retorna o resultado da inspeção ou None (e coloca em quarentena) se rejeitado.
    """
    if not validate_file_extension(file_path.name):
        print(f"[JackIn Shield] REJEITADO por extensão: {file_path.name}", file=sys.stderr)
        quarantine_file(file_path, f"{reason_prefix} com extensão proibida")
        return None
    inspection = inspect_video_stream(file_path)
    if not inspection:
        print(f"[JackIn Shield] REJEITADO na inspeção: {file_path.name}", file=sys.stderr)
        quarantine_file(file_path, f"{reason_prefix} reprovado na inspeção de mídia")
        return None
    return inspection
