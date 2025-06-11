import argparse
import json
import os
import sys
import wave
import time

from vosk import Model, KaldiRecognizer

def load_audio(file_path):
    wf = wave.open(file_path, "rb")
    if wf.getnchannels() != 1 or wf.getsampwidth() != 2 or wf.getcomptype() != "NONE":
        raise ValueError("Audio must be WAV format mono PCM.")
    return wf

def transcribe(wf, recognizer, timeout):
    transcript = ""
    start_time = time.time()

    while True:
        data = wf.readframes(4000)
        if len(data) == 0:
            break

        if recognizer.AcceptWaveform(data):
            result = json.loads(recognizer.Result())
            transcript += result.get("text", "") + " "

        if timeout and (time.time() - start_time) > timeout:
            raise TimeoutError("Transcription timeout reached")

    final_result = json.loads(recognizer.FinalResult())
    transcript += final_result.get("text", "")
    return transcript.strip()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True, help="Path to the audio file")
    parser.add_argument("--model", required=True, help="Path to Vosk model directory")
    parser.add_argument("--timeout", type=int, default=5)

    args = parser.parse_args()

    try:
        if not os.path.exists(args.model):
            raise FileNotFoundError(f"Model not found at {args.model}")

        wf = load_audio(args.file)
        model = Model(args.model)
        recognizer = KaldiRecognizer(model, wf.getframerate())

        transcript = transcribe(wf, recognizer, args.timeout)
        print(json.dumps({ "transcript": transcript }))
    except Exception as e:
        print(json.dumps({ "error": str(e) }))
        sys.exit(1)

if __name__ == "__main__":
    main()
