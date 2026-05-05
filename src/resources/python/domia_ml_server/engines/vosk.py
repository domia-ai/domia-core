import json
import os
import wave
from typing import Dict, Optional

from vosk import Model, KaldiRecognizer

_models: Dict[str, Model] = {}
_default_model_name: Optional[str] = None


def _model_path(model_name: str) -> str:
    return os.path.join("src/resources/stt-models/vosk", model_name)


def is_loaded() -> bool:
    return len(_models) > 0


def load(model_name: str = "vosk-model-small-en-us-0.15") -> None:
    global _default_model_name
    if model_name in _models:
        return
    path = _model_path(model_name)
    if not os.path.exists(path):
        raise FileNotFoundError(f"Vosk model not found at {path}")
    _models[model_name] = Model(path)
    if _default_model_name is None:
        _default_model_name = model_name


def transcribe(file_path: str, model_name: Optional[str]) -> str:
    name = model_name or _default_model_name or "vosk-model-small-en-us-0.15"
    if name not in _models:
        load(name)
    model = _models[name]

    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Audio file not found at {file_path}")

    with wave.open(file_path, "rb") as wf:
        if wf.getnchannels() != 1 or wf.getsampwidth() != 2 or wf.getcomptype() != "NONE":
            raise ValueError("Audio must be WAV format mono PCM.")

        recognizer = KaldiRecognizer(model, wf.getframerate())
        transcript = ""
        while True:
            data = wf.readframes(4000)
            if len(data) == 0:
                break
            if recognizer.AcceptWaveform(data):
                result = json.loads(recognizer.Result())
                transcript += result.get("text", "") + " "
        final = json.loads(recognizer.FinalResult())
        transcript += final.get("text", "")
        return transcript.strip()
