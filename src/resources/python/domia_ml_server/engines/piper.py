import io
import os
from typing import Dict, Optional

from piper import PiperVoice

_voices: Dict[str, PiperVoice] = {}
_default_voice: Optional[str] = None


def _voice_path(voice_name: str) -> str:
    return os.path.join("src/resources/tts-models/piper", voice_name, "voice.onnx")


def is_loaded() -> bool:
    return len(_voices) > 0


def load(voice_name: str = "en_US-libritts_r-medium") -> None:
    global _default_voice
    if voice_name in _voices:
        return
    path = _voice_path(voice_name)
    if not os.path.exists(path):
        raise FileNotFoundError(f"Piper voice model not found at {path}")
    _voices[voice_name] = PiperVoice.load(path)
    if _default_voice is None:
        _default_voice = voice_name


def synthesize(text: str, voice: Optional[str]) -> bytes:
    voice_name = voice or _default_voice or "en_US-libritts_r-medium"
    if voice_name not in _voices:
        load(voice_name)
    piper_voice = _voices[voice_name]
    import wave

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav_file:
        piper_voice.synthesize_wav(text, wav_file)
    return buf.getvalue()
