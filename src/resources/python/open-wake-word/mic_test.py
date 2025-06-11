import sounddevice as sd
import numpy as np
import scipy.io.wavfile as wav
import argparse
import os

parser = argparse.ArgumentParser(description="Microphone test recording script")
parser.add_argument('--duration', type=int, default=5, help='Duration of the recording in seconds')
parser.add_argument('--rate', type=int, default=16000, help='Sampling rate in Hz')
parser.add_argument('--device', type=int, help='Input device ID (optional)')
args = parser.parse_args()

# Output file path
output_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "tmp"))
os.makedirs(output_dir, exist_ok=True)
output_file = os.path.join(output_dir, "mic_test_output.wav")

print(f"🎙️ Recording for {args.duration} seconds at {args.rate} Hz...")
audio = sd.rec(
    int(args.duration * args.rate),
    samplerate=args.rate,
    channels=1,
    dtype='int16',
    device=args.device if args.device is not None else None
)

sd.wait()
print("✅ Recording completed.")

# RMS (Root Mean Square) to determine audio level
rms = np.sqrt(np.mean(audio.astype(np.float64)**2))
print(f"🔍 RMS value: {rms:.4f}")

if rms < 100:
    print("⚠️ Warning: Audio appears to be silent or very low volume.")

# Save the recorded audio
wav.write(output_file, args.rate, audio)
print(f"💾 Audio saved to: {output_file}")
