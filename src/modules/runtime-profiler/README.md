# runtime-profiler

Detects device capabilities in real-time (CPU, RAM, installed models) and defines the execution profile (`tiny`, `core`, `boost`, etc.).

> Allows DOMIA to automatically adapt to the hardware it runs on.

## Description

The Runtime Profiler is a dynamic module that continuously monitors and analyzes the host device's capabilities. It ensures optimal performance by automatically adjusting DOMIA's resource usage and feature set based on the available hardware resources.

## Key Features

- Real-time hardware monitoring
- Dynamic execution profile selection
- Resource utilization optimization
- Automatic performance scaling
- Hardware capability detection
- Model availability tracking

## Execution Profiles

- `tiny`: Minimal resource usage, basic features
- `core`: Standard performance, balanced features
- `boost`: Maximum performance, all features enabled

## Integration Points

- System resource monitoring
- Model selection and loading
- Performance optimization
- Feature availability management
