import argparse
import os
import wave
from piper import PiperVoice
import soundfile as sf

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--text', type=str, required=True)
    parser.add_argument('--model_path', type=str, required=True)
    parser.add_argument('--config_path', type=str, required=True)
    parser.add_argument('--output_path', type=str, required=True)
    args = parser.parse_args()

    voice = PiperVoice.load(args.model_path, args.config_path)

    with wave.open(args.output_path, "wb") as wav_file:
        voice.synthesize(args.text, wav_file)

if __name__ == "__main__":
    main()