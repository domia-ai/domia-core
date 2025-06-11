import sounddevice as sd

print("🎧 Available Audio Devices:")
for idx, device in enumerate(sd.query_devices()):
    print(f"[{idx}] {device['name']} - {device['max_input_channels']} in / {device['max_output_channels']} out")
