#!/usr/bin/env python3
"""Centralized configuration for JackIn media Python services.

Everything configurable here can be overridden via environment variables:
  - P2P_TRACKERS       comma-separated list of BitTorrent trackers
  - MEDIA_APIS         semicolon-separated "name=url" list for external APIs
  - FFMPEG_BIN         path to ffmpeg
  - FFPROBE_BIN        path to ffprobe
  - ARIA2_BIN          path to aria2c
  - YTDLP_BIN          path to yt-dlp
  - P2P_INSECURE_SSL   1 to disable SSL certificate verification on scrapers
"""
import os
import shutil
import ssl


def get_binary(name: str, *fallbacks: str) -> str:
    env_key = name.upper() + "_BIN"
    env_value = os.environ.get(env_key)
    if env_value:
        if os.path.exists(env_value) or shutil.which(env_value):
            return env_value
    # Prefer explicitly provided paths first (e.g. ffmpeg-full with drawtext)
    for path in fallbacks:
        if os.path.exists(path):
            return path
    found = shutil.which(name)
    if found:
        return found
    return name


def get_unverified_context():
    if not INSECURE_SSL:
        return ssl.create_default_context()
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


FFMPEG_BIN = get_binary("ffmpeg")
FFPROBE_BIN = get_binary("ffprobe")
ARIA2_BIN = get_binary("aria2c")

DEFAULT_TRACKERS = [
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.demonii.com:1337/announce",
    "udp://tracker.openbittorrent.com:6969/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://ipv4.tracker.harry.lu:80/announce",
    "udp://tracker.moeking.me:6969/announce",
    "udp://tracker.tiny-vps.com:6969/announce",
    "udp://tracker.tamersunion.org:1337/announce",
    "udp://tracker.dler.org:6969/announce",
    "udp://tracker.pirateparty.gr:6969/announce",
    "udp://tracker.gbitt.info:80/announce",
    "udp://tracker.bittor.pw:1337/announce",
]

P2P_TRACKERS = (
    [t.strip() for t in os.environ.get("P2P_TRACKERS", "").split(",") if t.strip()]
    if os.environ.get("P2P_TRACKERS")
    else DEFAULT_TRACKERS
)

TRACKERS_QUERY = "&" + "&".join(f"tr={t}" for t in P2P_TRACKERS)
TRACKERS_COMMA = ",".join(t for t in P2P_TRACKERS if t.startswith("udp://"))

_DEFAULT_APIS = {
    "apibay": "https://apibay.org",
    "yts": "https://yts.am",
    "itunes": "https://itunes.apple.com/search",
}

MEDIA_APIS = dict(_DEFAULT_APIS)
for pair in os.environ.get("MEDIA_APIS", "").split(";"):
    if "=" in pair:
        name, url = pair.split("=", 1)
        MEDIA_APIS[name.strip()] = url.strip()

INSECURE_SSL = os.environ.get("P2P_INSECURE_SSL", "0") == "1"

ENABLE_1337X = os.environ.get("ENABLE_1337X", "1") == "1"
ENABLE_NYAA = os.environ.get("ENABLE_NYAA", "1") == "1"
ENABLE_PROWLARR = os.environ.get("ENABLE_PROWLARR", "1") == "1"
PROWLARR_URL = os.environ.get("PROWLARR_URL", "http://localhost:9696")
