from . import kokoro, piper, vosk, whisper

TTS_ENGINES = {
    "KOKORO": kokoro,
    "PIPER": piper,
}

STT_ENGINES = {
    "VOSK": vosk,
    "WHISPER": whisper,
}

ALL_ENGINES = {**TTS_ENGINES, **STT_ENGINES}


def is_tts(engine: str) -> bool:
    return engine.upper() in TTS_ENGINES


def is_stt(engine: str) -> bool:
    return engine.upper() in STT_ENGINES
