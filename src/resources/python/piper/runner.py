import argparse
import wave
from piper import PiperVoice

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--text', type=str, required=True)
    parser.add_argument('--model_path', type=str, required=True)
    parser.add_argument('--output_path', type=str, required=True)
    args = parser.parse_args()

    voice = PiperVoice.load(args.model_path)

    with wave.open(args.output_path, "wb") as wav_file:
        voice.synthesize_wav(args.text, wav_file)

if __name__ == "__main__":
    main()
