import os
from typing import Dict, Optional

from pywhispercpp.model import Model

_models: Dict[str, Model] = {}
_default_model_name: Optional[str] = None


def _model_path(model_name: str) -> str:
    return os.path.join(
        "src/resources/stt-models/whisper", model_name, "ggml-model.bin"
    )


def is_loaded() -> bool:
    return len(_models) > 0


def load(model_name: str = "small.en") -> None:
    global _default_model_name
    if model_name in _models:
        return
    path = _model_path(model_name)
    if not os.path.exists(path):
        raise FileNotFoundError(f"Whisper model not found at {path}")
    _models[model_name] = Model(
        path, language="en", print_realtime=False, print_progress=False
    )
    if _default_model_name is None:
        _default_model_name = model_name


def transcribe(file_path: str, model_name: Optional[str]) -> str:
    name = model_name or _default_model_name or "small.en"
    if name not in _models:
        load(name)
    model = _models[name]

    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Audio file not found at {file_path}")

    segments = model.transcribe(file_path)
    return " ".join(seg.text.strip() for seg in segments).strip()
