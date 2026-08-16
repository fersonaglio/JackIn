#!/usr/bin/env python3
"""
Model downloader — baixa modelos Whisper/MediaPipe com progresso via SSE.
Uso: python3 download_model.py --config <path>
  config: { "model_name": "whisper-tiny" }
"""
import sys
import json
import os
import time

# Force tqdm to show progress bar even when stdout/stderr is redirected (non-TTY)
try:
    import tqdm
    original_init = tqdm.tqdm.__init__
    def new_init(self, *args, **kwargs):
        kwargs["disable"] = False
        original_init(self, *args, **kwargs)
    tqdm.tqdm.__init__ = new_init
except ImportError:
    pass

WHISPER_MODELS = ["tiny", "base", "small", "medium", "large-v3", "turbo"]

def emit_progress(progress: int, status: str):
    print(json.dumps({"progress": progress, "status": status}), file=sys.stderr)

def download_hf_model(model_name: str, repo_id: str) -> str:
    from huggingface_hub import snapshot_download

    cache_dir = os.path.expanduser("~/.cache/huggingface/hub")
    repo_folder = f"models--{repo_id.replace('/', '--')}"
    local_dir = os.path.join(cache_dir, repo_folder)

    if os.path.exists(local_dir) and len(os.listdir(local_dir)) > 0:
        emit_progress(100, f"Modelo {model_name} já existe em {local_dir}")
        return local_dir

    os.makedirs(cache_dir, exist_ok=True)
    emit_progress(0, f"Baixando {model_name} de {repo_id}...")

    snapshot_download(
        repo_id=repo_id,
        resume_download=True,
    )

    emit_progress(100, f"{model_name} baixado com sucesso!")
    return local_dir

def download_whisper(model_name: str) -> str:
    from huggingface_hub import snapshot_download

    size = model_name.replace("whisper-", "")
    cache_dir = os.path.expanduser("~/.cache/whisper")
    repo_id = f"Systran/faster-whisper-{size}"
    local_dir = os.path.join(cache_dir, f"faster-whisper-{size}")

    if os.path.exists(local_dir) and len(os.listdir(local_dir)) > 3:
        emit_progress(100, f"Modelo {model_name} já existe em {local_dir}")
        return local_dir

    os.makedirs(cache_dir, exist_ok=True)
    emit_progress(0, f"Baixando {model_name} de {repo_id}...")

    snapshot_download(
        repo_id=repo_id,
        local_dir=local_dir,
        local_dir_use_symlinks=False,
        resume_download=True,
    )

    emit_progress(100, f"{model_name} baixado com sucesso!")
    return local_dir

def download_mediapipe(model_name: str) -> str:
    import urllib.request
    import shutil

    MEDIAPIPE_URLS = {
        "mediapipe-face-detection": "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite",
    }

    url = MEDIAPIPE_URLS.get(model_name)
    if not url:
        raise ValueError(f"URL desconhecida para {model_name}")

    home = os.path.expanduser("~")
    dest_dir = os.path.join(home, ".cache", "mediapipe")
    os.makedirs(dest_dir, exist_ok=True)
    dest_path = os.path.join(dest_dir, "blaze_face_short_range.tflite")

    if os.path.exists(dest_path):
        emit_progress(100, f"Modelo já existe em {dest_path}")
        return dest_path

    emit_progress(0, f"Baixando {model_name}...")

    def report(block_count, block_size, total_size):
        if total_size > 0:
            pct = min(int(block_count * block_size / total_size * 100), 99)
            emit_progress(pct, f"Baixando... {pct}%")

    urllib.request.urlretrieve(url, dest_path, reporthook=report)
    emit_progress(100, f"{model_name} baixado com sucesso!")
    return dest_path

if __name__ == "__main__":
    idx = sys.argv.index("--config") if "--config" in sys.argv else -1
    config = {}
    if idx >= 0:
        config_path = sys.argv[idx + 1]
        with open(config_path) as f:
            config = json.load(f)

    model_name = config.get("model_name", "")
    repo_id = config.get("repo_id", "")
    
    if not model_name:
        print(json.dumps({"error": "model_name é obrigatório"}))
        sys.exit(1)

    try:
        if repo_id:
            result_path = download_hf_model(model_name, repo_id)
        elif model_name.startswith("whisper-"):
            result_path = download_whisper(model_name)
        elif model_name.startswith("mediapipe-"):
            result_path = download_mediapipe(model_name)
        else:
            raise ValueError(f"Tipo de modelo desconhecido: {model_name}")

        print(json.dumps({"success": True, "model_name": model_name, "path": result_path}))
    except Exception as e:
        print(f"download_model.py: ERRO: {e}", file=sys.stderr)
        emit_progress(0, f"Erro: {e}")
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)
