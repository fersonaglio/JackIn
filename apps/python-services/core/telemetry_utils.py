#!/usr/bin/env python3
"""
Telemetry & Logging Utilities for JackIn Python Services.
Provides structured metric logging, execution timing, and video orientation inspection.
"""

import sys
import json
import time
import subprocess
import functools
from pathlib import Path


def log_metric(event: str, data: dict):
    """
    Emits a structured JSON telemetry log to stderr.
    """
    payload = {
        "tag": "JackInTelemetry",
        "event": event,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "data": data,
    }
    print(f"[JackIn Telemetry] {json.dumps(payload)}", file=sys.stderr, flush=True)


class StageTimer:
    """
    Context manager to measure and log duration of pipeline stages.
    """
    def __init__(self, stage_name: str, extra_data: dict = None):
        self.stage_name = stage_name
        self.extra_data = extra_data or {}
        self.start_time = None

    def __enter__(self):
        self.start_time = time.time()
        log_metric("stage_start", {"stage": self.stage_name, **self.extra_data})
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        duration_ms = int((time.time() - self.start_time) * 1000)
        status = "failed" if exc_type else "success"
        log_metric("stage_complete", {
            "stage": self.stage_name,
            "duration_ms": duration_ms,
            "status": status,
            **self.extra_data
        })


def timer(stage_name: str):
    """
    Decorator to measure execution time of a function.
    """
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            with StageTimer(stage_name, {"function": func.__name__}):
                return func(*args, **kwargs)
        return wrapper
    return decorator


def probe_video_orientation(video_path: str | Path) -> dict:
    """
    Uses ffprobe to analyze video dimensions, aspect ratio, and orientation.
    Detects if the video is Landscape (paisagem), Portrait (retrato), or Square (quadrado).
    """
    path_obj = Path(video_path)
    if not path_obj.exists():
        log_metric("probe_error", {"error": f"File not found: {video_path}"})
        return {
            "width": 0,
            "height": 0,
            "aspect_ratio": "unknown",
            "orientation": "unknown",
            "is_landscape": False,
            "error": "file_not_found"
        }

    try:
        cmd = [
            "ffprobe",
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height,display_aspect_ratio,r_frame_rate",
            "-of", "json",
            str(path_obj)
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        data = json.loads(result.stdout)
        streams = data.get("streams", [])

        if not streams:
            return {
                "width": 0,
                "height": 0,
                "aspect_ratio": "unknown",
                "orientation": "unknown",
                "is_landscape": False,
                "error": "no_video_stream"
            }

        vstream = streams[0]
        width = int(vstream.get("width", 0))
        height = int(vstream.get("height", 0))
        display_aspect_ratio = vstream.get("display_aspect_ratio", "")

        if width > height:
            orientation = "landscape"
            is_landscape = True
        elif height > width:
            orientation = "portrait"
            is_landscape = False
        else:
            orientation = "square"
            is_landscape = False

        if not display_aspect_ratio or display_aspect_ratio == "N/A":
            if height > 0:
                calc_ratio = round(width / height, 2)
                display_aspect_ratio = f"{calc_ratio}:1"
            else:
                display_aspect_ratio = "unknown"

        metrics = {
            "video_path": str(path_obj.name),
            "width": width,
            "height": height,
            "aspect_ratio": display_aspect_ratio,
            "orientation": orientation,
            "is_landscape": is_landscape,
        }

        log_metric("video_orientation_probe", metrics)
        return metrics

    except Exception as e:
        log_metric("probe_error", {"error": str(e), "file": str(path_obj.name)})
        return {
            "width": 0,
            "height": 0,
            "aspect_ratio": "unknown",
            "orientation": "unknown",
            "is_landscape": False,
            "error": str(e)
        }
