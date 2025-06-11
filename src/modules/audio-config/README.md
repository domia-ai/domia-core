# audio-config

Contains configuration related to audio input and output hardware.

> Defines which microphone and speaker to use, their volume, format, etc.

## Description

This module manages audio device configuration in DOMIA, providing a flexible system for handling different audio setups across various operating systems. It supports multiple audio input and output methods, device selection, and audio format configuration.

## Data Model

```
model DeviceAudioConfig {
  id           String   @id @default(uuid())
  domiaId      String   @unique
  os           String   // "macos", "linux", "windows"
  audioInput   String   // "sox", "arecord", "custom"
  audioOutput  String   // "say", "aplay", "ffplay"
  inputDevice  String?  // optional, device name
  outputDevice String?  // optional, speaker name
  sampleRate   Int?     // e.g.: 16000
  default      Boolean  @default(false)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
```

## Module Structure

```
src/modules/audio-config/
├── index.ts                     // Exports main functions
├── getAudioConfig.ts            // Returns current config from DB
├── setAudioConfig.ts            // Allows modification
├── detectDefaultAudioSetup.ts   // Automatically detects available input/output
├── listInputDevices.ts          // Lists available microphones
├── listOutputDevices.ts         // Lists available speakers
└── types.ts                     // Types and enums
```

## Main Functions

```
// Returns audio configuration for a domia
function getAudioConfig(domiaId: string): Promise<AudioConfig>

// Attempts to automatically detect a valid configuration
function detectDefaultAudioSetup(): Promise<Partial<AudioConfig>>

// Returns list of available input devices
function listInputDevices(): Promise<string[]>

// Returns list of available output devices
function listOutputDevices(): Promise<string[]>
```
