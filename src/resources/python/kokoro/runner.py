import argparse
import os
import subprocess
import numpy as np
import soundfile as sf
from kokoro import KPipeline
from phonemizer.backend.espeak.wrapper import EspeakWrapper


def _ensure_espeak():
    if os.environ.get("ESPEAK_LIBRARY"):
        EspeakWrapper.set_library(os.environ["ESPEAK_LIBRARY"])
        return
    try:
        prefix = subprocess.check_output(
            ["brew", "--prefix", "espeak-ng"], text=True
        ).strip()
        EspeakWrapper.set_library(f"{prefix}/lib/libespeak-ng.1.dylib")
    except Exception:
        pass


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--text", required=True)
    p.add_argument("--voice", required=True)
    p.add_argument("--output_path", required=True)
    args = p.parse_args()

    _ensure_espeak()

    pipeline = KPipeline(lang_code="a")
    chunks = [audio for _, _, audio in pipeline(args.text, voice=args.voice)]
    audio = np.concatenate(chunks) if len(chunks) > 1 else chunks[0]
    sf.write(args.output_path, audio, 24000)


if __name__ == "__main__":
    main()
