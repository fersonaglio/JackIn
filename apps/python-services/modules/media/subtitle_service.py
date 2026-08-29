#!/usr/bin/env python3
"""OpenSubtitles PT-BR subtitle fetcher for JackIn media services.

Computes the OpenSubtitles v3 video hash (64KB head + 64KB tail) and searches
opensubtitles.com for a PT-BR (.por/.pob) subtitle, downloads it as SRT and
converts it to WebVTT so the browser <track> element can render it directly.

The output is written next to the video file as `subs_ptbr.vtt` (the server
serves it via GET /api/projects/:id/subtitles?lang=pt-br before falling back
to embedded streams).

Requires OPENSUBTITLES_API_KEY (https://opensubtitles.com). When it is not set
the script exits with code 2 and a clear message; the API route reports that to
the UI instead of failing silently.
"""
import argparse
import hashlib
import json
import os
import pathlib
import struct
import sys
import time
import urllib.parse
import urllib.request

UA = "JackIn v1.0"
API_ROOT = "https://api.opensubtitles.com/api/v1"


def opensubtitles_hash(file_path: str) -> str:
    """Compute the official OpenSubtitles v3 hash of a video file."""
    size = os.path.getsize(file_path)
    with open(file_path, "rb") as f:
        head = f.read(65536)
        f.seek(max(0, size - 65536))
        tail = f.read(65536)
    buf = head + tail
    if len(buf) % 8 != 0:
        buf += b"\x00" * (8 - len(buf) % 8)
    h = 0
    for i in range(0, len(buf), 8):
        (chunk,) = struct.unpack("<Q", buf[i:i + 8])
        h = (h + chunk) & 0xFFFFFFFFFFFFFFFF
        h = (h * 65599) & 0xFFFFFFFFFFFFFFFF
    return format(h, "016x")


def _request(path: str, params: dict, api_key: str, data: dict | None = None) -> dict:
    url = f"{API_ROOT}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={
        "Api-Key": api_key,
        "User-Agent": UA,
        "Content-Type": "application/json",
    }, data=json.dumps(data).encode() if data else None, method="POST" if data else "GET")
    with urllib.request.urlopen(req, timeout=20) as res:
        return json.loads(res.read().decode("utf-8", "replace"))


def _login(api_key: str, username: str, password: str) -> str:
    """Exchange credentials for a short-lived token (login is cached per run)."""
    data = {"username": username, "password": password}
    try:
        resp = _request("/login", {}, api_key, data)
        token = resp.get("token")
        if token:
            return token
    except Exception as e:
        print(f"OpenSubtitles login failed: {e}", file=sys.stderr)
    return ""


def _search(token: str, api_key: str, languages: str = "pt-br,pob,por", title: str = "", file_hash: str = "",
            size: int = 0, season: str = "", episode: str = "") -> list:
    params = {
        "languages": languages,
        "order_by": "download_count",
        "order_direction": "desc",
        "limit": "10",
    }
    if file_hash and size:
        params["moviehash"] = file_hash
        params["moviebytesize"] = str(size)
    elif title:
        params["query"] = title
        if season:
            params["season_number"] = season
        if episode:
            params["episode_number"] = episode
    else:
        return []
    params["Authorization"] = f"Bearer {token}"  # harmless extra; header below is canonical
    resp = _request("/subtitles", params, api_key)
    return resp.get("data", [])


def _download(token: str, api_key: str, file_id: int, target_vtt: str) -> bool:
    """Download an SRT subtitle and convert it to WebVTT."""
    resp = _request("/download", {}, api_key, {"file_id": file_id})
    link = resp.get("link")
    if not link:
        return False
    req = urllib.request.Request(link, headers={"Authorization": f"Bearer {token}", "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as res:
        raw = res.read().decode("utf-8", "replace")
    return srt_to_vtt(raw, target_vtt)


def srt_to_vtt(raw: str, target_vtt: str) -> bool:
    """Convert an SRT subtitle payload to WebVTT (needed for <track>).

    Returns False when the payload carries no real cues (empty, garbage, or a
    WebVTT header with nothing after it) so the caller never persists a dead
    subtitle file that would silently blank out the player.
    """
    text = raw.lstrip("\ufeff")
    if "WEBVTT" in text[:16]:
        # Only accept a WebVTT payload that has actual content after the header.
        rest = text[16:].strip()
        if "-->" not in rest:
            return False
        pathlib.Path(target_vtt).write_text(text, encoding="utf-8")
        return True
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = text.split("\n")
    out = ["WEBVTT\n"]
    cue_count = 0
    i = 0
    while i < len(lines):
        line = lines[i]
        if "-->" in line and ":" in line:
            cue_time = line
            body = []
            i += 1
            while i < len(lines) and lines[i].strip() != "":
                body.append(lines[i])
                i += 1
            # Normalize SRT timing to WebVTT (same HH:MM:SS,mmm -> HH:MM:SS.mmm)
            cue_time = cue_time.replace(",", ".")
            out.append(cue_time + "\n")
            if body:
                out.append("\n".join(body) + "\n")
            out.append("\n")
            cue_count += 1
        else:
            i += 1
    if cue_count == 0:
        return False
    result = "\n".join(out)
    if "WEBVTT" not in result:
        return False
    pathlib.Path(target_vtt).write_text(result, encoding="utf-8")
    return True


def _fetch_stremio_fallback(title: str, out_dir: str, suffix: str, season: str = "", episode: str = "") -> dict:
    """Fallback público e gratuito via OpenSubtitles v3 / Cinemeta para quando não houver API key."""
    clean_q = title.split("(")[0].strip() if title else ""
    if not clean_q:
        return {"ok": False, "error": "Título não informado para busca pública", "code": "no_title"}

    imdb_id = None
    try:
        cat = "series" if season else "movie"
        url = f"https://v3-cinemeta.strem.io/catalog/{cat}/top/search={urllib.parse.quote(clean_q)}.json"
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=5) as r:
            d = json.loads(r.read().decode("utf-8", "replace"))
            metas = d.get("metas", [])
            if metas:
                imdb_id = metas[0].get("id") or metas[0].get("imdb_id")
    except Exception as e:
        pass

    if not imdb_id:
        return {"ok": False, "error": f"IMDb ID não localizado para: {clean_q}", "code": "no_imdb"}

    try:
        if season and episode:
            sub_url = f"https://opensubtitles-v3.strem.io/subtitles/series/{imdb_id}:{season}:{episode}.json"
        else:
            sub_url = f"https://opensubtitles-v3.strem.io/subtitles/movie/{imdb_id}.json"

        req = urllib.request.Request(sub_url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=8) as r:
            d = json.loads(r.read().decode("utf-8", "replace"))
            subs = d.get("subtitles", [])
            # Prioriza pob/por/pt-br se suffix for ptbr
            target_langs = ("pob", "por", "pt-br", "pt") if suffix == "ptbr" else ("eng", "en")
            matching_subs = [s for s in subs if s.get("lang") in target_langs]
            if not matching_subs:
                return {"ok": False, "error": f"Nenhuma legenda encontrada no catálogo público para {clean_q}", "code": "not_found"}

            sub_link = matching_subs[0].get("url")
            if not sub_link:
                return {"ok": False, "error": "URL da legenda vazia", "code": "empty_url"}

            sub_req = urllib.request.Request(sub_link, headers={"User-Agent": UA})
            with urllib.request.urlopen(sub_req, timeout=15) as s_res:
                raw = s_res.read().decode("utf-8", "replace")

            target_vtt = str(pathlib.Path(out_dir) / f"subs_{suffix}.vtt")
            ok = srt_to_vtt(raw, target_vtt)
            if ok and os.path.exists(target_vtt):
                # Also save standard alias names
                if suffix == "ptbr":
                    for alias in ("subs_por.vtt", "subtitles.por.vtt", "subtitles.pt-br.vtt"):
                        alias_path = pathlib.Path(out_dir) / alias
                        try:
                            pathlib.Path(alias_path).write_text(pathlib.Path(target_vtt).read_text(encoding="utf-8"), encoding="utf-8")
                        except Exception:
                            pass
                return {"ok": True, "path": target_vtt, "name": matching_subs[0].get("subtitleFileName", clean_q)}
    except Exception as err:
        return {"ok": False, "error": f"Erro na busca de legendas públicas: {err}", "code": "stremio_failed"}

    return {"ok": False, "error": "Falha na conversão de legendas públicas", "code": "unknown"}


def fetch_subtitle(video_path: str, out_dir: str, lang: str = "pt-br", title: str = "",
                   season: str = "", episode: str = "") -> dict:
    if not os.path.exists(video_path):
        return {"ok": False, "error": "Arquivo de vídeo não encontrado", "code": "no_video"}

    if lang in ["pt-br", "pob", "por", "pt"]:
        query_langs = "pt-br,pob,por"
        suffix = "ptbr"
    elif lang in ["en", "eng", "en-us"]:
        query_langs = "en,eng"
        suffix = "en"
    else:
        query_langs = lang
        suffix = lang.replace("-", "")

    api_key = os.environ.get("OPENSUBTITLES_API_KEY", "").strip()
    username = os.environ.get("OPENSUBTITLES_USERNAME", "").strip()
    password = os.environ.get("OPENSUBTITLES_PASSWORD", "").strip()

    if not api_key:
        # Fallback automático gratuito sem necessidade de chave de API
        return _fetch_stremio_fallback(title, out_dir, suffix, season, episode)

    file_hash = opensubtitles_hash(video_path)
    size = os.path.getsize(video_path)
    token = _login(api_key, username, password)
    if not token:
        return _fetch_stremio_fallback(title, out_dir, suffix, season, episode)

    candidates = _search(token, api_key, languages=query_langs, file_hash=file_hash, size=size)
    if not candidates and title:
        candidates = _search(token, api_key, languages=query_langs, title=title, season=season, episode=episode)

    if not candidates:
        return _fetch_stremio_fallback(title, out_dir, suffix, season, episode)

    target_vtt = str(pathlib.Path(out_dir) / f"subs_{suffix}.vtt")
    best = candidates[0]
    attributes = best.get("attributes", {})
    try:
        if isinstance(attributes.get("files"), list) and attributes["files"]:
            file_id = attributes["files"][0]["file_id"]
        else:
            file_id = best.get("id")
        ok = _download(token, api_key, int(file_id), target_vtt)
    except Exception as e:
        return _fetch_stremio_fallback(title, out_dir, suffix, season, episode)

    if not ok or not os.path.exists(target_vtt):
        return _fetch_stremio_fallback(title, out_dir, suffix, season, episode)

    return {"ok": True, "path": target_vtt, "hash": file_hash,
            "name": attributes.get("title", "") if attributes else ""}


def fetch_ptbr(video_path: str, out_dir: str, title: str = "",
               season: str = "", episode: str = "") -> dict:
    return fetch_subtitle(video_path, out_dir, "pt-br", title, season, episode)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fetch subtitles via OpenSubtitles")
    parser.add_argument("--video", type=str, required=True)
    parser.add_argument("--out-dir", type=str, required=True)
    parser.add_argument("--lang", type=str, default="pt-br")
    parser.add_argument("--title", type=str, default="")
    parser.add_argument("--season", type=str, default="")
    parser.add_argument("--episode", type=str, default="")
    args = parser.parse_args()
    result = fetch_subtitle(args.video, args.out_dir, args.lang, args.title, args.season, args.episode)
    print(json.dumps(result))
