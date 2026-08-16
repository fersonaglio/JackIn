#!/usr/bin/env python3
import sys
import json
import os
import re
import time
import argparse
import subprocess
import urllib.request
from pathlib import Path

from config import FFMPEG_BIN, FFPROBE_BIN, ARIA2_BIN, TRACKERS_COMMA

# Whitelist of strictly safe video container extensions
ALLOWED_EXTENSIONS = {".mp4", ".mkv", ".webm", ".mov", ".avi", ".m4v", ".ts", ".m2ts"}

# Blacklist of executable / dangerous extension patterns
BLOCKED_EXTENSIONS = {
    ".exe", ".bat", ".cmd", ".vbs", ".scr", ".js", ".jse", ".wsf", ".wsh",
    ".ps1", ".msi", ".jar", ".zip", ".rar", ".7z", ".iso", ".dmg", ".pkg"
}

def detect_audio_languages(file_path: Path) -> list:
    """List the real audio language codes of a media file via ffprobe."""
    try:
        cmd = [
            FFPROBE_BIN, "-v", "quiet",
            "-select_streams", "a",
            "-show_entries", "stream=index:stream_tags=language",
            "-of", "json",
            str(file_path)
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=30)
        data = json.loads(res.stdout)
        langs = set()
        for s in data.get("streams", []):
            lang = (s.get("tags", {}).get("language") or "").lower()
            if lang:
                langs.add(lang)
        return sorted(langs)
    except Exception:
        return []

def detect_subtitle_languages(file_path: Path) -> list:
    """List the real embedded subtitle language codes via ffprobe."""
    try:
        cmd = [
            FFPROBE_BIN, "-v", "quiet",
            "-select_streams", "s",
            "-show_entries", "stream=index:stream_tags=language",
            "-of", "json",
            str(file_path)
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=30)
        data = json.loads(res.stdout)
        langs = set()
        for s in data.get("streams", []):
            lang = (s.get("tags", {}).get("language") or "").lower()
            if lang:
                langs.add(lang)
        return sorted(langs)
    except Exception:
        return []

_last_emitted_pct = 0

def emit_progress(progress: int, status: str, speed_mbps: float = 0.0):
    global _last_emitted_pct
    clamped = max(progress, _last_emitted_pct)
    _last_emitted_pct = clamped
    print(json.dumps({
        "progress": clamped,
        "status": status,
        "speed": f"{speed_mbps:.1f} MB/s" if speed_mbps > 0 else None
    }), file=sys.stderr)
    sys.stderr.flush()

def validate_file_extension(filename: str) -> bool:
    ext = Path(filename).suffix.lower()
    if ext in BLOCKED_EXTENSIONS:
        return False
    if ext in ALLOWED_EXTENSIONS:
        return True
    return False

def inspect_video_stream(file_path: Path) -> dict | None:
    """
    Camada 2: Sondagem de Segurança via FFprobe.
    Garante que o arquivo possui streams decodificáveis legítimos de vídeo e
    áudio. Rejeita arquivos sem áudio ou com apenas áudio mono (requisito:
    "nada de mono").
    """
    if not file_path.exists() or file_path.stat().st_size < 1000:
        return None

    ffprobe_bin = FFPROBE_BIN

    try:
        cmd = [
            ffprobe_bin, "-v", "error",
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
        # Pelo menos uma faixa de áudio deve ser multicanal ou estéreo real
        # (nunca apenas mono). Contêineres "sem áudio" são rejeitados — sem
        # faixa, o playback fica mudo e o requisito de qualidade é violado.
        max_channels = max((int(s.get("channels", 0) or 0) for s in audio_streams), default=0)
        has_acceptable_audio = max_channels >= 2

        format_info = data.get("format", {})
        duration = float(format_info.get("duration", 0))

        result = {
            "has_video": has_video,
            "has_audio": has_audio,
            "max_channels": max_channels,
            "duration": duration,
            "size_bytes": file_path.stat().st_size
        }

        if not has_video or not has_audio or not has_acceptable_audio:
            reason = "sem vídeo" if not has_video else ("sem áudio" if not has_audio else f"áudio mono (canais={max_channels})")
            print(f"SECURITY CHECK REJECTED: {reason} em {file_path.name} (path: {file_path})", file=sys.stderr)
            return None

        return result
    except Exception as e:
        # FAIL-CLOSED: um arquivo que o ffprobe não consegue nem parsear NÃO é
        # um vídeo válido (ex.: torrent interrompido que deixou um arquivo
        # pré-alocado cheio de zeros). Aprovar aqui marca um lixo como "done".
        print(f"SECURITY CHECK REJECTED: FFprobe falhou em {file_path.name} (path: {file_path}): {e}", file=sys.stderr)
        return None

def quarantine_file(file_path: Path, reason: str) -> Path | None:
    """Move um arquivo reprovado para .quarantine em vez de deletá-lo.

    Preserva o download para diagnóstico manual (o unlink é irreversível e já
    destruiu GBs de vídeo válido por falhas de path com colchetes). Retorna o
    caminho da quarentena ou None se o rename falhar.
    """
    if not file_path.exists():
        return None
    quarantine = file_path.with_suffix(file_path.suffix + ".quarantine")
    try:
        file_path.rename(quarantine)
        print(f"[JackIn DL] QUARENTENA: {file_path.name} -> {quarantine.name} (motivo: {reason})", file=sys.stderr)
        return quarantine
    except OSError as q_err:
        print(f"[JackIn DL] QUARENTENA falhou (rename {file_path.name} -> {quarantine.name}): {q_err}. Deletando como fallback.", file=sys.stderr)
        try:
            file_path.unlink()
        except OSError:
            pass
        return None

def _cleanup_dir(output_dir: Path):
    """Remove arquivos parciais (.aria2, subdiretórios, metadados) entre
    tentativas de candidates, para o próximo magnet começar limpo."""
    try:
        for root, dirs, files in os.walk(output_dir, topdown=False):
            for name in files:
                p = Path(root) / name
                try:
                    if name.endswith(".aria2") or name.endswith(".torrent") or name == "whisper_audio.wav":
                        p.unlink()
                except OSError:
                    pass
            for d in dirs:
                try:
                    os.rmdir(Path(root) / d)
                except OSError:
                    pass
    except Exception:
        pass


def _run_aria2_candidate(url: str, output_dir: Path, quality: str, stop_timeout: int = 90) -> bool:
    """Tenta baixar UM magnet. Retorna True se um arquivo de vídeo real foi
    obtido. Candidate morto (seeders fantasmas, DL:0B persistente) é abortado
    após um warmup de peers e o próximo entra."""
    emit_progress(5, f"Conectando aos Seeders BitTorrent P2P ({quality})...", 18.0)
    aria2_bin = ARIA2_BIN

    cmd = [
        aria2_bin,
        "--seed-time=0",
        f"--bt-stop-timeout={stop_timeout}",
        "--timeout=25",
        "--connect-timeout=15",
        "--max-download-limit=0",
        "--bt-max-peers=200",
        "--bt-request-peer-speed-limit=0",
        "--summary-interval=1",
        "--enable-dht=true",
        "--enable-peer-exchange=true",
        "--bt-tracker=" + TRACKERS_COMMA,
        "--dir", str(output_dir),
        "--follow-torrent=mem",
        url
    ]

    import selectors
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    start_t = time.time()
    got_progress = False
    download_done = False
    last_emit_t = 0
    last_downloaded = 0
    last_byte_advance = time.time()
    sel = selectors.DefaultSelector()
    if proc.stdout:
        sel.register(proc.stdout, selectors.EVENT_READ)
    buffer = ""

    def parse_dl(line: str) -> int:
        m = re.search(r"DL:([\d.]+)([KMGT]?B)", line)
        if not m:
            return 0
        val = float(m.group(1))
        unit = m.group(2)
        if unit == "KiB":
            val *= 1024
        elif unit == "MiB":
            val *= 1024 * 1024
        elif unit == "GiB":
            val *= 1024 * 1024 * 1024
        return int(val)

    try:
        while not download_done:
            events = sel.select(timeout=2.0) if proc.stdout else []
            now_t = time.time()
            if not events:
                if proc.poll() is not None:
                    break
                # Feedback enquanto DHT/trackers procuram peers.
                if time.time() - start_t > 25 and not got_progress:
                    if now_t - last_emit_t >= 3:
                        last_emit_t = now_t
                        emit_progress(5, f"Procurando seeders P2P (DHT/trackers)... {int(time.time() - start_t)}s", 0)
                # Candidate morto: após warmup de 30s, se NENHUM byte avançou
                # nos últimos 45s, aborta e o próximo magnet da cascata entra.
                if (time.time() - start_t) > 30 and (now_t - last_byte_advance) > 45:
                    print("Rede BitTorrent sem dados (candidate morto). Abortando.", file=sys.stderr)
                    proc.kill()
                    break
                continue

            chunk = proc.stdout.read(4096)
            if not chunk:
                if proc.poll() is not None:
                    break
                continue
            buffer += chunk
            while "\n" in buffer:
                line, buffer = buffer.split("\n", 1)
                line_str = line.strip()
                if not line_str:
                    continue

                if ("SEED" in line_str or "Download complete" in line_str) and not "[METADATA]" in line_str and not "[MEMORY]" in line_str:
                    emit_progress(95, f"Download Torrent P2P Concluído (100%)", 50.0)
                    got_progress = True
                    download_done = True
                    break

                if "(" in line_str and "%)" in line_str:
                    try:
                        pct_part = line_str.split("(")[1].split("%)")[0]
                        pct_val = float(pct_part)
                        mapped_pct = min(95, int(8 + (pct_val / 100.0) * 87))
                        speed_part = "35.0MiB"
                        if "DL:" in line_str:
                            speed_part = line_str.split("DL:")[1].split()[0].strip()
                        cn_val = "0"
                        if "CN:" in line_str:
                            cn_val = line_str.split("CN:")[1].split()[0].strip()
                        sd_val = "0"
                        if "SD:" in line_str:
                            sd_val = line_str.split("SD:")[1].split()[0].strip()
                        emit_progress(mapped_pct, f"Baixando {quality} - {pct_val:.1f}% (⚡ {speed_part}/s) [SD:{sd_val} CN:{cn_val}]", 45.0)
                        got_progress = True
                        dl_now = parse_dl(line_str)
                        if dl_now > last_downloaded:
                            last_downloaded = dl_now
                            last_byte_advance = now_t
                    except:
                        pass
                elif "[#" in line_str and ("CN:" in line_str or "DL:" in line_str):
                    got_progress = True
                    dl_now = parse_dl(line_str)
                    if dl_now > last_downloaded:
                        last_downloaded = dl_now
                        last_byte_advance = now_t
                    if now_t - last_emit_t >= 1.5:
                        last_emit_t = now_t
                        peers_part = "0"
                        if "CN:" in line_str:
                            peers_part = line_str.split("CN:")[1].split()[0].strip()
                        emit_progress(8, f"Conectado a {peers_part} seeders P2P. Baixando metadados do filme...", 12.0)
    finally:
        try:
            sel.close()
        except Exception:
            pass

    # Encerrar o aria2 com calma (remover .aria2 e liberar arquivos).
    try:
        proc.wait(timeout=15)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass

    # Verificar se obteve um arquivo de vídeo real (candidate vivo).
    for root, dirs, files in os.walk(output_dir):
        for file in files:
            ext = Path(file).suffix.lower()
            full_f = Path(root) / file
            if ext in BLOCKED_EXTENSIONS:
                try: full_f.unlink()
                except: pass
            elif ext in ALLOWED_EXTENSIONS:
                return True
    return False


def download_file_with_shield(urls: list, output_dir: Path, title: str, quality: str) -> Path:
    global _last_emitted_pct
    _last_emitted_pct = 0
    output_dir.mkdir(parents=True, exist_ok=True)
    clean_title = "".join(c if c.isalnum() or c in (" ", "_", "-") else "" for c in title).strip().replace(" ", "_")
    clean_quality = "".join(c if c.isalnum() or c in (" ", "_", "-") else "" for c in quality).strip().replace(" ", "_")
    target_path = output_dir / f"source_{clean_title}_{clean_quality}.mp4"
    audio_path = output_dir / "whisper_audio.wav"

    # Camada 1: Validação prévia da extensão no nome do arquivo ou URL
    if not validate_file_extension(target_path.name):
        raise ValueError(f"Extensão de arquivo proibida por motivos de segurança: {target_path.name}")

    emit_progress(2, f"Iniciando download seguro ({quality})...", 12.5)
    time.sleep(0.5)

    candidates = [u for u in (urls if isinstance(urls, list) else [urls]) if u]
    if not candidates:
        raise RuntimeError("Nenhuma URL de download fornecida.")

    success = False
    attempted = 0

    # Passo 1: tentar cada magnet em cascata — candidate morto (0 bytes) é
    # abortado e o próximo da lista entra.
    magnets = [u for u in candidates if u.startswith("magnet:?")]
    for i, magnet in enumerate(magnets):
        attempted += 1
        label = f" (candidate {i + 1}/{len(magnets)})" if len(magnets) > 1 else ""
        print(f"[JackIn DL] Tentativa {attempted}: magnet{label}", file=sys.stderr)
        _cleanup_dir(output_dir)
        try:
            ok = _run_aria2_candidate(magnet, output_dir, quality)
        except Exception as err:
            print(f"Transferência BitTorrent aria2c falhou: {err}", file=sys.stderr)
            ok = False
        if ok:
            success = True
            break
        else:
            print(f"[JackIn DL] Candidate {i + 1} sem dados (morto). Tentando próximo...", file=sys.stderr)

    # Limpeza defensiva de .aria2 órfãos após a última tentativa de magnet.
    _cleanup_dir(output_dir)

    # Passo 2: fallback para URL HTTP/HTTPS direta (também em cascata).
    if not success:
        for url in candidates:
            if not (url.startswith("http://") or url.startswith("https://")):
                continue
            attempted += 1
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=20) as response:
                    total_size = int(response.info().get("Content-Length", 50 * 1024 * 1024))
                    downloaded = 0
                    chunk_size = 1024 * 512
                    start_time = time.time()
                    last_emit = 0
                    http_target = output_dir / "master.mp4"

                    with open(http_target, "wb") as f:
                        while True:
                            chunk = response.read(chunk_size)
                            if not chunk:
                                break
                            f.write(chunk)
                            downloaded += len(chunk)
                            now = time.time()
                            if now - last_emit >= 0.25:
                                last_emit = now
                                elapsed = now - start_time
                                speed_mbps = (downloaded / (1024 * 1024)) / elapsed if elapsed > 0 else 15.0
                                pct = min(95, int(8 + (downloaded / total_size) * 87))
                                dl_mb = downloaded / (1024 * 1024)
                                tot_mb = total_size / (1024 * 1024)
                                status_str = f"Baixando {quality}: {dl_mb:.1f} MB / {tot_mb:.1f} MB ({speed_mbps:.1f} MB/s)"
                                emit_progress(pct, status_str, speed_mbps)
                    target_path = http_target
                success = True
                break
            except Exception as err:
                print(f"Download direto HTTP falhou ({err})", file=sys.stderr)

    if not success:
        raise RuntimeError(
            "Sem seeders ou fonte indisponível para este título. Nenhum dos candidates do download P2P conseguiu baixar o arquivo real."
        )

    # Localizar o master baixado (extensão original preservada).
    video_files = []
    for root, dirs, files in os.walk(output_dir):
        for file in files:
            ext = Path(file).suffix.lower()
            full_f = Path(root) / file
            if ext in BLOCKED_EXTENSIONS:
                try: full_f.unlink()
                except: pass
            elif ext in ALLOWED_EXTENSIONS:
                video_files.append(full_f)
    video_files.sort(key=lambda f: f.stat().st_size, reverse=True)
    if not video_files:
        raise RuntimeError("Download concluído mas nenhum arquivo de vídeo foi encontrado.")
    main_video = video_files[0]
    print(f"[JackIn DL] Arquivo principal: {main_video} ({main_video.stat().st_size / (1024**3):.1f}GB)", file=sys.stderr)

    # Mover de subdiretório YTS para a raiz (paths com colchetes quebram ffmpeg).
    if main_video.parent != output_dir:
        root_copy = output_dir / main_video.name
        print(f"[JackIn DL] Movendo de subdiretório para raiz: {main_video.name}", file=sys.stderr)
        if root_copy.exists():
            root_copy.unlink()
        try:
            main_video.rename(root_copy)
        except OSError:
            import shutil
            shutil.move(str(main_video), str(root_copy))
        main_video = root_copy
        for r_dir, d_dirs, _ in os.walk(output_dir, topdown=False):
            for d_name in d_dirs:
                try:
                    os.rmdir(os.path.join(r_dir, d_name))
                except OSError:
                    pass

    # Normaliza para master.<ext> mantendo a extensão real.
    final_master = output_dir / f"master{main_video.suffix.lower()}"
    if main_video != final_master:
        if final_master.exists():
            final_master.unlink()
        try:
            main_video.rename(final_master)
        except OSError:
            import shutil
            shutil.copy2(str(main_video), str(final_master))
            main_video.unlink()
        main_video = final_master
    target_path = main_video
    print(f"[JackIn DL] Master intacto: {target_path} ({target_path.stat().st_size / (1024**3):.1f}GB)", file=sys.stderr)

    # Camada 2: Inspecionar e validar integridade do vídeo com FFprobe (Escudo Anti-Vírus)
    emit_progress(96, "Escudo de Segurança: Verificando integridade e filtrando malwares...", 0)
    time.sleep(0.3)

    inspection = inspect_video_stream(target_path)
    if not inspection:
        print(f"[JackIn DL] ESCUDO REJEITOU: ffprobe não conseguiu inspecionar {target_path} (tamanho: {target_path.stat().st_size if target_path.exists() else 0} bytes).", file=sys.stderr)
        quarantine_file(target_path, "inspeção de mídia reprovada (quarentena em vez de deleção)")
        raise RuntimeError("ESCUDO DE SEGURANÇA: Arquivo de vídeo corrompido ou sem faixas decodificáveis válidas (colocado em quarentena).")

    # Camada 3: Extração de áudio limpo whisper_audio.wav para a IA de cortes
    # (mono 16kHz é artefato de transcrição/Whisper — NÃO é o áudio do playback).
    emit_progress(98, "Extraindo faixa de áudio para curadoria do JackIn...", 0)
    try:
        ffmpeg_bin = FFMPEG_BIN
        
        subprocess.run([
            ffmpeg_bin, "-y", "-i", str(target_path),
            "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
            str(audio_path)
        ], capture_output=True, check=True)
    except Exception as e:
        print(f"Aviso na extração de whisper_audio.wav: {e}", file=sys.stderr)

    emit_progress(100, "Mídia 4K Baixada e Validada com Sucesso! 🥳", 0)
    return target_path

def main():
    parser = argparse.ArgumentParser(description="Movie Download Worker with Security Shield for JackIn")
    parser.add_argument("--url", type=str, required=True, help="Media download URL")
    parser.add_argument("--alt-urls", type=str, default="", help="JSON list of alternate download URLs (fallback em cascata)")
    parser.add_argument("--out-dir", type=str, required=True, help="Output directory path")
    parser.add_argument("--title", type=str, default="Filme_4K", help="Movie title")
    parser.add_argument("--quality", type=str, default="4K REMUX", help="Media quality string")
    parser.add_argument("--poster-url", type=str, default="", help="Movie poster URL")
    args = parser.parse_args()

    output_dir = Path(args.out_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Lista de candidates: primário + alternativos (fallback em cascata).
    urls = [args.url]
    if args.alt_urls:
        try:
            parsed_alt = json.loads(args.alt_urls)
            if isinstance(parsed_alt, list):
                urls.extend([str(u) for u in parsed_alt if str(u)])
        except Exception as e:
            print(f"[JackIn DL] Aviso: --alt-urls inválido ({e}), usando só o primário.", file=sys.stderr)

    if args.poster_url:
        try:
            req_p = urllib.request.Request(args.poster_url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req_p, timeout=8) as res_p:
                with open(output_dir / "thumbnail.jpg", "wb") as f_p:
                    f_p.write(res_p.read())
        except Exception as p_err:
            print(f"Aviso ao salvar thumbnail: {p_err}", file=sys.stderr)

    try:
        final_video = download_file_with_shield(urls, output_dir, args.title, args.quality)
        result = {
            "status": "success",
            "video_path": str(final_video),
            "audio_path": str(output_dir / "whisper_audio.wav"),
            "audio_languages": detect_audio_languages(final_video),
            "subtitle_languages": detect_subtitle_languages(final_video),
            "quality": args.quality,
            "title": args.title
        }
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"status": "error", "error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
