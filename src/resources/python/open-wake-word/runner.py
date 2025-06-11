import argparse
import sys
import time
import os
import sounddevice as sd
import numpy as np
from openwakeword.model import Model

def main():
    parser = argparse.ArgumentParser(description="Run OpenWakeWord listener")
    parser.add_argument('--model', required=True, help="Model name (without extension)")
    parser.add_argument('--sensitivity', type=float, default=0.5)
    parser.add_argument('--rate', type=int, default=16000)
    parser.add_argument('--threshold', type=float, default=0.5)
    parser.add_argument('--framework', choices=["onnx", "tflite"], default="onnx")
    parser.add_argument('--device', type=int)
    parser.add_argument('--cooldown', type=float, default=2.0, help='Cooldown time in seconds')
    parser.add_argument('--debug', action='store_true', help='Print prediction scores')
    args = parser.parse_args()

    try:
        device_index = args.device if args.device is not None else sd.default.device[0]
        device_info = sd.query_devices(device_index)
        if args.debug:
            print(f"[debug] Using device: {device_info['name']}", flush=True)
    except Exception as e:
        print(f"error:DEVICE_SELECTION:{e}", flush=True)
        sys.exit(1)

    ext = "tflite" if args.framework == "tflite" else "onnx"
    base_path = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "wake-word", "open-wake-word")
    )

    model_path = os.path.join(base_path, f"{args.model}.{ext}")
    melspec_path = os.path.join(base_path, f"melspectrogram.{ext}")
    embedding_path = os.path.join(base_path, f"embedding_model.{ext}")

    try:
        model = Model(
            wakeword_models=[model_path],
            inference_framework=args.framework,
            melspec_model_path=melspec_path,
            embedding_model_path=embedding_path
        )
    except Exception as e:
        print(f"error:MODEL_INIT:{e}", flush=True)
        sys.exit(1)

    model_key = list(model.models.keys())[0]
    if args.debug:
        print(f"[debug] Listening for '{model_key}' | threshold={args.threshold} sensitivity={args.sensitivity} cooldown={args.cooldown}s", flush=True)

    last_detected = 0

    def callback(indata, frames, time_info, status):
        nonlocal last_detected

        if status and args.debug:
            print(f"[warning] Stream status: {status}", flush=True)

        audio = np.squeeze((indata * 32767).astype(np.int16))

        try:
            prediction = model.predict(audio, threshold={model_key: args.threshold})
            score = prediction.get(model_key, 0.0)

            now = time.time()
            if score >= args.threshold and (now - last_detected) >= args.cooldown:
                print("wakeword_detected", flush=True)
                last_detected = now
            elif args.debug:
                print(f"[score] {score:.4f}", flush=True)
        except Exception as e:
            if args.debug:
                print(f"error:PREDICTION:{e}", flush=True)

    try:
        with sd.InputStream(
            callback=callback,
            device=device_index,
            channels=1,
            samplerate=args.rate,
            dtype='float32'
        ):
            while True:
                time.sleep(0.1)
    except Exception as e:
        print(f"error:MIC_STREAM:{e}", flush=True)
        sys.exit(1)

if __name__ == "__main__":
    main()
