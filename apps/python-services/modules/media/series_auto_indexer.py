#!/usr/bin/env python3
import sqlite3, os, time, re, uuid, subprocess, shutil, json, sys
from pathlib import Path

# Garante importação do config
_CURRENT_DIR = Path(__file__).resolve().parent
if str(_CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(_CURRENT_DIR))

try:
    from config import FFMPEG_BIN, DATA_DIR
except ImportError:
    FFMPEG_BIN = "ffmpeg"
    DATA_DIR = Path(_CURRENT_DIR.parents[3] / "data")

db_path = str(DATA_DIR / "jackin.db")
base_dir = DATA_DIR / "projects"

def get_series_list():
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    # Pega todas as séries registradas
    rows = c.execute("SELECT id, title, video_path FROM projects WHERE project_type = 'series' AND (episode_number IS NULL OR episode_number = 0)").fetchall()
    conn.close()
    return rows

def index_all_series():
    conn = sqlite3.connect(db_path)
    c = conn.cursor()

    series_list = get_series_list()
    total_indexed = 0

    for s_id, s_title, _ in series_list:
        clean_title = re.sub(r"\(.*?\)", "", s_title).strip()
        print(f"[Series Pipeline] 📺 Indexando série: {s_title} ({s_id})...")
        
        # Procura poster base da série
        parent_dir = base_dir / s_id
        poster_src = parent_dir / "thumbnail.jpg" if (parent_dir / "thumbnail.jpg").exists() else None

        seen_eps = set()
        found_eps = []

        # Varre data/projects procurando episódios
        for pdir in base_dir.iterdir():
            if not pdir.is_dir(): continue
            for f in pdir.rglob("*"):
                if not f.is_file() or f.suffix.lower() not in (".mkv", ".mp4"):
                    continue
                # Se o arquivo for muito pequeno (< 30MB), ignora
                if f.stat().st_size < 30_000_000:
                    continue

                m = re.search(r"S(\d{1,2})[Ee](\d{1,2})", f.name, re.I)
                if not m:
                    m = re.search(r"(\d{1,2})x(\d{1,2})", f.name, re.I)
                
                if not m: continue
                season = int(m.group(1))
                episode = int(m.group(2))
                key = f"{season}-{episode}"
                
                if key in seen_eps: continue
                
                # Validação de cabeçalho de vídeo
                try:
                    with open(f, "rb") as fh:
                        head = fh.read(16)
                        if not ((head[0] == 0x1a and head[1] == 0x45) or b"ftyp" in head):
                            continue
                except:
                    continue

                # Confirma se o nome do arquivo bate com o título da série
                f_lower = f.name.lower()
                clean_terms = [w.lower() for w in clean_title.split() if len(w) > 2]
                if any(t in f_lower for t in clean_terms) or str(pdir.name) == s_id:
                    seen_eps.add(key)
                    found_eps.append((season, episode, str(f.resolve()), f.stat().st_size))

        for season, episode, v_path, sz in sorted(found_eps):
            ep_title = f"{clean_title} S{season:02d}E{episode:02d}"
            existing = c.execute(
                "SELECT id, status, video_path FROM projects WHERE series_id = ? AND season_number = ? AND episode_number = ?",
                (s_id, season, episode)
            ).fetchone()

            if existing:
                ep_id = existing[0]
                if existing[1] != "done" or existing[2] != v_path:
                    c.execute(
                        "UPDATE projects SET status = 'done', progress_pct = 100, video_path = ?, progress_status = 'Episódio Pronto! 🥳' WHERE id = ?",
                        (v_path, ep_id)
                    )
            else:
                ep_id = str(uuid.uuid4())
                c.execute(
                    "INSERT INTO projects (id, youtube_url, title, status, project_type, video_path, series_id, season_number, episode_number, progress_pct, progress_status) VALUES (?, '', ?, 'done', 'series', ?, ?, ?, ?, 100, 'Episódio Pronto! 🥳')",
                    (ep_id, ep_title, v_path, s_id, season, episode)
                )
            
            # Gera thumbnail do episódio
            ep_dir = base_dir / ep_id
            ep_dir.mkdir(parents=True, exist_ok=True)
            thumb = ep_dir / "thumbnail.jpg"
            if not thumb.exists():
                try:
                    subprocess.run(
                        ["ffmpeg", "-y", "-ss", "00:01:00", "-i", v_path, "-vframes", "1", "-q:v", "2", str(thumb)],
                        capture_output=True, timeout=15
                    )
                except:
                    pass
            if not thumb.exists() and poster_src and poster_src.exists():
                shutil.copyfile(str(poster_src), str(thumb))

            total_indexed += 1

    conn.commit()
    conn.close()
    return total_indexed

if __name__ == "__main__":
    count = index_all_series()
    print(f"✓ Pipeline de séries concluído com sucesso: {count} episódios indexados!")
