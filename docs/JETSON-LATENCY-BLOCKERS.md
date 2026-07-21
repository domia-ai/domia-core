# Jetson latency — blockers, workarounds, and what's left

State as of 2026-07-18, after the deep-dive sprint. Perceived TTFA on the satellite went **~1.7s → ~1.4s** (compute p50 1268ms → **936ms**, bench `qwen3-nothink-2026-07-18.json`) with quality intact (WER 11.5%, 0 failures). This documents every blocker we measured, what we did about it, and what's genuinely left — so nothing gets re-investigated blind.

> **UPDATE 2026-07-19: Qwen3-1.7B was REVERTED to Llama-3.2-3B.** It won every speed and tool gate but produced verbatim multi-turn repetition loops in real conversation (caught by ear, then reproduced). The failure became a permanent eval: `assertCoherence` (noRepeat/noEcho) + `evals/cases/conversation-coherence.json`. LLM numbers below that cite Qwen3 describe the experiment, not the current config.

## Where the time goes now (measured)

| Component                             | p50        | Status                                     |
| ------------------------------------- | ---------- | ------------------------------------------ |
| Endpoint / silence wait               | ~450ms     | smart-turn v3.2 gate; floor of silence-VAD |
| STT decode (parakeet, CPU, 4 threads) | ~216ms     | champion; GPU measured and LOST (below)    |
| LLM to first token (Qwen3-1.7B)       | ~227ms     | swapped from Llama-3.2-3B (−39%)           |
| TTS first chunk (Piper)               | ~120-160ms | solved                                     |
| ESPHome device buffer                 | ~150-250ms | blocked (library, below)                   |
| Hub glue / queues                     | ~14ms      | negligible                                 |

## Applied (measured wins)

1. **LLM → Qwen3-1.7B Q4_K_M** (was Llama-3.2-3B): 39.2 vs 22.8 tok/s (1.72×), TTFT 227 vs 374ms, llm_ms 529 vs 875. Frees ~0.7GB. Quality gate passed (0 bench failures, clean English replies). ⚠️ Qwen3 is a hybrid-thinking model: disable via `--chat-template-kwargs "{\"enable_thinking\":false}"` on llama-server — `--reasoning-budget 0` does NOT work (reasoning leaks into content).
2. **KV-cache quant** `-fa on -ctk q8_0 -ctv q8_0` (~235MB freed, <0.1% quality).
3. **smart-turn v3.1 → v3.2** (Jan 2026): −40% misclassification on short utterances, noise-trained. Drop-in (same `input_features`→`logits` tensors).
4. **STT threads 2→4**: −28% decode (372→266ms; 211-224 in-pipeline). threads=6 is WORSE (contention).
5. **Memory prefetch during the debounce** (`satellite-core`): the interactionId is created at first speech capture and `prefetchMemoryBundle` warms recent turns/facts/moods during the ~450ms wait — transcript-independent, zero invalidation risk.
6. **Endpoint debounce 550→450ms** with the v3.2 gate holding mid-sentence pauses.
7. **Piper (VITS libritts) TTS** — won speed AND the user's ear; throughput 4.5-10× every other engine (5.28 ms/char vs kitten 23.8 / pocket 36.8 / kokoro 51.8). TTS is solved; do not revisit.

## Dead ends — measured or verified, do NOT re-attempt without new facts

- **GPU-STT on this JetPack (the big one).** The CUDA-13/sm_87 toolchain gap WAS broken: we built `onnxruntime_gpu-1.23.0` from source (straga kit, wheel at the scratchpad `jetson-jp7-onnxruntime/dist/`, providers `[TensorRT, CUDA, CPU]` confirmed on-device). But **parakeet-tdt int8 on CUDA-EP measured SLOWER than CPU** (encoder 350ms GPU vs 334ms CPU; 742 Memcpy nodes — int8 QDQ ops lack CUDA kernels and bounce to CPU). sherpa-CPU does the FULL decode in 216ms — faster than the GPU encoder alone. **TensorRT-EP is untestable on 8GB: the engine build balloons to ~5.4GB RSS and the kernel OOM-killer fires (verified in dmesg, 3 kills) — it took down our tooling session repeatedly.** A fp16 (non-int8) ONNX export might avoid the Memcpy problem but needs a NeMo re-export and would roughly double model memory; not worth it while CPU is 216ms. **Verdict: parakeet-CPU stays champion; GPU-STT closed on this hardware.**
- **Riva ASR on Orin**: JP7 Riva targets Thor only; models are ~4GB+. Dead.
- **NeMo parakeet on CUDA-Jetson**: "no kernel image" (HF discussion #19). Dead.
- **Speculative decoding (EAGLE/Medusa/draft)**: not in llama.cpp; a draft for a 3B-class target is a losing trade (measured n-gram: +17% worse). Dead.
- **TensorRT-Edge-LLM**: issues [#94](https://github.com/NVIDIA/TensorRT-Edge-LLM/issues/94) (no prefix cache) and [#74](https://github.com/NVIDIA/TensorRT-Edge-LLM/issues/74) (KV-save crash) still open mid-2026; loses end-to-end to llama-server (1819 vs 841ms). Re-bench only when those close.
- **Streaming STT on this CPU**: no viable model in 2026 — parakeet-unified 4× slower than realtime (measured), streaming-zipformer-2023 +15pt WER and no better English streaming checkpoint exists; Moonshine v2 is exposed non-streaming only (and needs a new engine format: encoder + merged decoder). Satellite speculation (built and measured as Layer A, then reverted) is not viable without it: a fast-VAD early decode invalidates on natural mid-sentence pauses.
- **ESPHome low-latency PCM push**: `esphome-client` (npm) has NO speaker-push API — audio out is URL-announce only (`sendVoiceAssistantAnnounce`); `voiceAssistantAudio` is mic-inbound. The device buffer (~150-250ms) is reachable only via a different client/protocol (Wyoming streaming-TTS integration) or custom firmware. Product decision, not tuning.
- **`decodePaddingMs`** is a no-op for offline parakeet (only applied on the online branch). Not a lever.
- **TTS `provider: "cuda"`**: sherpa-onnx-node is CPU-only on aarch64. Dead (and unnecessary — Piper is fast).

## What's genuinely left (in order of value)

1. **Real-voice validation batch** of the stacked wins (Qwen3 + smart-turn v3.2 + prefetch + 450ms) — confirm ~1.4s perceived and no quality regressions by ear.
2. **Debounce 450→350ms**: synthetically validated (the gate held trap400/trap600); needs the real-voice batch to confirm with natural pauses.
3. **Wyoming streaming-TTS integration** for the Voice PE delivery path (cuts the last ~150-250ms device buffer without reflashing) — medium effort, new protocol work.
4. **LiveKit turn-detector v1-mini** if v3.2's residual endpoint noise still bothers (accuracy leader: 9.9% false-cutoff @300ms).
5. **Upstream watches**: sherpa FR #3573 (parakeet-unified stateful streaming — would unlock streaming STT AND satellite speculation), TensorRT-Edge #94/#74, sherpa-node CUDA-13 builds.
6. **Thor-class hardware** erases most of the above at once (memory, GPU, toolchain).

## Bottom line

The cheap-and-real workarounds are **banked** (−332ms compute, −0.7GB, better endpointing). What remains is either **on-device validation** (1-2), **protocol work** (3), **upstream** (5), or **hardware** (6). The practical floor for this box with this stack is ~1.2-1.4s perceived; sub-second needs streaming STT (upstream) or new hardware.
