import argparse
import json
import os
import sys

from pywhispercpp.model import Model


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True, help="Path to the audio file")
    parser.add_argument("--model", required=True, help="Path to whisper.cpp ggml model file")
    parser.add_argument("--timeout", type=int, default=10)
    args = parser.parse_args()

    try:
        if not os.path.exists(args.model):
            raise FileNotFoundError(f"Model not found at {args.model}")
        if not os.path.exists(args.file):
            raise FileNotFoundError(f"Audio file not found at {args.file}")

        model = Model(
            args.model,
            language="en",
            print_realtime=False,
            print_progress=False,
        )
        segments = model.transcribe(args.file)
        transcript = " ".join(seg.text.strip() for seg in segments).strip()
        print(json.dumps({"transcript": transcript}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
