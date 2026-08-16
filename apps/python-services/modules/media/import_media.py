#!/usr/bin/env python3
import os
import sys
import uuid
import sqlite3
import argparse
import shutil
import subprocess
from pathlib import Path
from urllib.parse import urlparse

# telemetry_utils lives in apps/python-services/core — make it importable
# regardless of the working directory this CLI is invoked from.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "core"))

import requests
from tqdm import tqdm

from telemetry_utils import probe_video_orientation, log_metric
from config import get_binary, FFMPEG_BIN
from media_shield import validate_file_extension, shield_file

# Setup paths relative to script location
SCRIPT_DIR = Path(__file__).resolve().parent
WORKSPACE_DIR = SCRIPT_DIR.parent.parent
DB_PATH = WORKSPACE_DIR / "data" / "jackin.db"
PROJECTS_DIR = WORKSPACE_DIR / "data" / "projects"

def get_yt_dlp_bin():
    found = get_binary("yt-dlp")
    if found == "yt-dlp" and not shutil.which("yt-dlp"):
        return None
    return found

def download_direct_file(url: str, output_path: Path):
    print(f"[*] Baixando arquivo direto do link: {url}")
    response = requests.get(url, stream=True, timeout=60)
    response.raise_for_status()
    total_size = int(response.headers.get('content-length', 0))
    
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_path, 'wb') as file, tqdm(
        desc="Progresso",
        total=total_size,
        unit='iB',
        unit_scale=True,
        unit_divisor=1024,
    ) as bar:
        for data in response.iter_content(chunk_size=1024 * 512):
            size = file.write(data)
            bar.update(size)
    print(f"[+] Download concluído com sucesso: {output_path}")

def download_with_ytdlp(url: str, output_dir: Path, filename_template: str) -> tuple[str, str]:
    yt_dlp_bin = get_yt_dlp_bin()
    if not yt_dlp_bin:
        raise RuntimeError("yt-dlp não está instalado ou não foi encontrado no PATH.")
    
    print(f"[*] Utilizando yt-dlp ({yt_dlp_bin}) para baixar: {url}")
    output_template = str(output_dir / filename_template)
    
    cmd = [
        yt_dlp_bin,
        "-f", "bestvideo[height<=2160]+bestaudio/best[height<=2160]",
        "-o", output_template,
        "--print", "after_move:filename",
        "--print", "after_move:title",
        url
    ]
    
    # Use centralized ffmpeg location
    ffmpeg_bin = FFMPEG_BIN
    if ffmpeg_bin and ffmpeg_bin != "ffmpeg":
        cmd.extend(["--ffmpeg-location", str(Path(ffmpeg_bin).parent)])
        
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Erro no yt-dlp: {result.stderr.strip()}")
        
    lines = result.stdout.strip().split("\n")
    downloaded_path = lines[0] if len(lines) > 0 else ""
    title = lines[1] if len(lines) > 1 else "Vídeo Ingerido"
    
    return downloaded_path, title

def main():
    parser = argparse.ArgumentParser(description="Ingere mídias (filmes, desenhos, séries) de links ou arquivos no pipeline do JackIn.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--url", help="URL do vídeo (direct MP4 link, Internet Archive page, YouTube, etc.)")
    group.add_argument("--file", help="Caminho local para o arquivo de vídeo")
    parser.add_argument("--title", help="Título do projeto (opcional)")
    parser.add_argument("--language", help="Idioma do áudio para Whisper (opcional, ex: 'pt', 'en', 'es')")
    
    args = parser.parse_args()
    
    # 1. Generate unique project ID
    project_id = str(uuid.uuid4())
    project_dir = PROJECTS_DIR / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    
    final_video_path = None
    title = args.title or "Mídia Importada"
    source_url = ""
    
    # 2. Ingest Media
    try:
        if args.file:
            local_file = Path(args.file).resolve()
            if not local_file.exists():
                print(f"[!] Erro: Arquivo local não encontrado em '{local_file}'", file=sys.stderr)
                sys.exit(1)

            # Escudo: extensão permitida + ffprobe (fail-closed).
            if not validate_file_extension(local_file.name):
                print(f"[!] Erro: extensão de arquivo proibida: {local_file.name}", file=sys.stderr)
                sys.exit(1)

            ext = local_file.suffix or ".mp4"
            final_video_path = project_dir / f"original{ext}"
            print(f"[*] Copiando arquivo de vídeo local '{local_file.name}'...")
            shutil.copy2(local_file, final_video_path)

            if not shield_file(final_video_path, "arquivo local importado"):
                print(f"[!] Erro: arquivo local reprovado pelo escudo de segurança (em quarentena).", file=sys.stderr)
                sys.exit(1)

            # Normaliza para master.<ext> preservando a extensão real.
            master_path = project_dir / f"master{ext}"
            final_video_path.rename(master_path)
            final_video_path = master_path

            if not args.title:
                title = local_file.stem
            print(f"[+] Arquivo local copiado para: {final_video_path}")

        elif args.url:
            source_url = args.url
            parsed_url = urlparse(args.url)
            path_suffix = Path(parsed_url.path).suffix.lower()

            # If it is a direct video link, download directly using requests
            if path_suffix in ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v', '.ts', '.m2ts']:
                final_video_path = project_dir / f"original{path_suffix}"
                download_direct_file(args.url, final_video_path)

                if not shield_file(final_video_path, "download direto"):
                    print(f"[!] Erro: download direto reprovado pelo escudo de segurança (em quarentena).", file=sys.stderr)
                    sys.exit(1)

                master_path = project_dir / f"master{path_suffix}"
                final_video_path.rename(master_path)
                final_video_path = master_path

                if not args.title:
                    title = Path(parsed_url.path).stem.replace('-', ' ').replace('_', ' ').title()
            else:
                # Use yt-dlp for streaming sites (Archive.org pages, YouTube, vimeo, etc.)
                downloaded_file, dl_title = download_with_ytdlp(args.url, project_dir, "original.%(ext)s")
                final_video_path = Path(downloaded_file)

                if not shield_file(final_video_path, "download yt-dlp"):
                    print(f"[!] Erro: download yt-dlp reprovado pelo escudo de segurança (em quarentena).", file=sys.stderr)
                    sys.exit(1)

                if not args.title:
                    title = dl_title

        # Escudo final sobre o arquivo normalizado (master.*).
        if final_video_path is None or not shield_file(final_video_path, "mídia importada"):
            print(f"[!] Erro: mídia reprovada pelo escudo de segurança.", file=sys.stderr)
            sys.exit(1)

        # 3. Add to jackin.db database
        if not DB_PATH.exists():
            print(f"[!] Erro: Banco de dados '{DB_PATH}' não encontrado.", file=sys.stderr)
            sys.exit(1)
            
        print(f"[*] Registrando projeto no banco de dados JackIn ({DB_PATH.name})...")
        conn = sqlite3.connect(str(DB_PATH))
        cursor = conn.cursor()
        
        # JackIn table: projects (id, youtube_url, title, status, project_type, created_at, video_path)
        cursor.execute(
            """
            INSERT INTO projects (id, youtube_url, title, status, project_type, created_at, video_path)
            VALUES (?, ?, ?, 'preparing', 'movie', datetime('now'), ?)
            """,
            (project_id, source_url, title, str(final_video_path))
        )
        conn.commit()
        conn.close()
        
        orientation_info = probe_video_orientation(final_video_path)
        is_landscape_str = "SIM (Paisagem)" if orientation_info.get("is_landscape") else "NÃO (Retrato/Outro)"

        print("\n" + "="*60)
        print(f"🎉 SUCESSO: Projeto '{title}' importado com sucesso!")
        print(f"🆔 ID do Projeto: {project_id}")
        print(f"📁 Pasta de Armazenamento: {project_dir}")
        print(f"📹 Arquivo de Vídeo: {final_video_path.name}")
        print(f"📐 Resolução & Orientação: {orientation_info.get('width')}x{orientation_info.get('height')} | Paisagem: {is_landscape_str}")
        print("-"*60)
        print("💡 COMO PROCESSAR OS CORTES:")
        print("1. Inicie o JackIn (npm run dev:all)")
        print(f"2. Abra a interface web no navegador (geralmente http://localhost:3000)")
        print(f"3. Seu projeto aparecerá na página inicial com status 'Pendente'.")
        print(f"4. Clique em 'Iniciar' ou 'Re-analisar' para que a IA processe a transcrição e cortes!")
        print("="*60 + "\n")
        
    except Exception as e:
        # Clean up directory on failure
        if project_dir.exists():
            shutil.rmtree(project_dir)
        print(f"[!] Erro durante a importação: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
