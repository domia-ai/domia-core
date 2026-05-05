import io
import os
import subprocess
from typing import Optional

import numpy as np
import soundfile as sf

_pipeline = None


def _ensure_espeak():
    if os.environ.get("ESPEAK_LIBRARY"):
        from phonemizer.backend.espeak.wrapper import EspeakWrapper

        EspeakWrapper.set_library(os.environ["ESPEAK_LIBRARY"])
        return
    try:
        prefix = subprocess.check_output(
            ["brew", "--prefix", "espeak-ng"], text=True
        ).strip()
        from phonemizer.backend.espeak.wrapper import EspeakWrapper

        EspeakWrapper.set_library(f"{prefix}/lib/libespeak-ng.1.dylib")
    except Exception:
        pass


def is_loaded() -> bool:
    return _pipeline is not None


def load() -> None:
    global _pipeline
    if _pipeline is not None:
        return
    _ensure_espeak()
    from kokoro import KPipeline

    _pipeline = KPipeline(lang_code="a")


def synthesize(text: str, voice: Optional[str]) -> bytes:
    if _pipeline is None:
        load()
    voice_name = voice or "af_heart"
    chunks = [audio for _, _, audio in _pipeline(text, voice=voice_name)]
    audio = np.concatenate(chunks) if len(chunks) > 1 else chunks[0]
    buf = io.BytesIO()
    sf.write(buf, audio, 24000, format="WAV")
    return buf.getvalue()
