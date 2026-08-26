#!/usr/bin/env python3
import sqlite3, os, time, re, uuid, subprocess, shutil
from pathlib import Path

db_path = "data/jackin.db"
series_id = "ab22c49a-3ac6-4c08-9ff6-345b722830ff"
base_title = "Love, Death & Robots"
base_dir = Path("data/projects")

poster_candidates = [
    "data/projects/ab22c49a-3ac6-4c08-9ff6-345b722830ff/thumbnail.jpg",
    "data/projects/dd7a1969-592a-41e9-a3bc-0bee7a213e49/thumbnail.jpg"
]
poster_src = next((p for p in poster_candidates if os.path.exists(p)), "")

def scan_and_index():
    db = sqlite3.connect(db_path)
    c = db.cursor()
    
    seen = set()
    found = []
    
    for pdir in base_dir.iterdir():
        if not pdir.is_dir(): continue
        for f in pdir.rglob("*"):
            if f.is_file() and f.suffix.lower() in (".mkv", ".mp4"):
                m = re.search(r"S(\d{1,2})[Ee](\d{1,2})", f.name, re.I)
                if not m: continue
                season = int(m.group(1))
                episode = int(m.group(2))
                key = f"{season}-{episode}"
                if key in seen: continue
                
                sz = f.stat().st_size
                if sz < 40_000_000: continue
                
                try:
                    with open(f, "rb") as fh:
                        head = fh.read(16)
                        if not ((head[0] == 0x1a and head[1] == 0x45) or b"ftyp" in head):
                            continue
                except:
                    continue
                
                seen.add(key)
                found.append((season, episode, str(f.resolve()), sz))

    updated = 0
    for season, episode, video_path, sz in sorted(found):
        ep_title = f"{base_title} S{season:02d}E{episode:02d}"
        existing = c.execute("SELECT id, status, video_path FROM projects WHERE series_id = ? AND season_number = ? AND episode_number = ?", (series_id, season, episode)).fetchone()
        
        if existing:
            ep_id = existing[0]
            if existing[1] != "done" or existing[2] != video_path:
                c.execute("UPDATE projects SET status = ?, progress_pct = 100, video_path = ?, progress_status = ? WHERE id = ?", ("done", video_path, "Mídia 1080p Pronta! 🥳", ep_id))
                updated += 1
        else:
            ep_id = str(uuid.uuid4())
            c.execute("INSERT INTO projects (id, youtube_url, title, status, project_type, video_path, series_id, season_number, episode_number, progress_pct, progress_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                      (ep_id, "", ep_title, "done", "series", video_path, series_id, season, episode, 100, "Mídia 1080p Pronta! 🥳"))
            updated += 1
        
        # Ensure thumbnail exists
        ep_dir = Path(f"data/projects/{ep_id}")
        ep_dir.mkdir(parents=True, exist_ok=True)
        thumb = ep_dir / "thumbnail.jpg"
        if not thumb.exists() and os.path.exists(video_path):
            subprocess.run(["ffmpeg", "-y", "-ss", "00:00:30", "-i", video_path, "-vframes", "1", "-q:v", "2", str(thumb)], capture_output=True)
        if not thumb.exists() and poster_src:
            shutil.copyfile(poster_src, thumb)

    db.commit()
    db.close()
    return len(found), updated

if __name__ == "__main__":
    total, up = scan_and_index()
    print(f"Scanned: {total} valid episodes total, {up} updated/added.")
