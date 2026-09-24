#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: scripts/llm-bench.sh <label> [--port 11435] [--runs 5] [--predict 96] [--parallel 2] [--out evals/bench-results]" >&2
  echo "  measures llama-server prefill and decode throughput with the box state recorded next to the numbers" >&2
  exit 2
}

LABEL="${1:-}"
case "$LABEL" in "" | -h | --help) usage ;; esac
shift
PORT=11435
RUNS=5
PREDICT=96
PARALLEL=2
OUT_DIR="evals/bench-results"
while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --runs) RUNS="$2"; shift 2 ;;
    --predict) PREDICT="$2"; shift 2 ;;
    --parallel) PARALLEL="$2"; shift 2 ;;
    --out) OUT_DIR="$2"; shift 2 ;;
    *) usage ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="http://127.0.0.1:$PORT"
OUT="$ROOT/$OUT_DIR/llm-bench-$LABEL.json"
mkdir -p "$(dirname "$OUT")"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

curl -s -m 5 "$BASE/health" | grep -q ok || { echo "❌ llama-server not healthy on :$PORT" >&2; exit 1; }
curl -s -m 5 "$BASE/props" > "$TMP/props.json"

PARAGRAPH="The house is quiet at night. A small lamp glows in the hallway, the kitchen clock ticks, and somewhere a radiator settles with a soft click. Outside, the street is empty and the wind moves the branches of the old tree by the gate."
PREFILL_PROMPT="$PARAGRAPH $PARAGRAPH $PARAGRAPH $PARAGRAPH $PARAGRAPH $PARAGRAPH Summarize the paragraph above in one sentence."
DECODE_PROMPT="Write a calm paragraph about a quiet house at night."

completion() {
  local prompt="$1" n="$2" file="$3"
  python3 - "$prompt" "$n" > "$file.body" <<'PY'
import json, sys
print(json.dumps({"prompt": sys.argv[1], "n_predict": int(sys.argv[2]), "temperature": 0, "cache_prompt": False}))
PY
  curl -s -m 180 "$BASE/completion" -H 'content-type: application/json' --data-binary "@$file.body" > "$file"
}

echo "🧪 llm-bench '$LABEL' on :$PORT — prefill x$RUNS, decode x$RUNS ($PREDICT tok), parallel x$PARALLEL"
for i in $(seq 1 "$RUNS"); do completion "$PREFILL_PROMPT" 1 "$TMP/prefill-$i.json"; done
for i in $(seq 1 "$RUNS"); do completion "$DECODE_PROMPT" "$PREDICT" "$TMP/decode-$i.json"; done
if [ "$PARALLEL" -gt 1 ]; then
  for i in $(seq 1 "$PARALLEL"); do completion "$DECODE_PROMPT $i" "$PREDICT" "$TMP/parallel-$i.json" & done
  wait
fi

read_sys() { cat "$1" 2>/dev/null | tr -d '\n' || true; }
thermal_json() {
  python3 - <<'PY'
import glob, json, os
out = {}
for z in glob.glob("/sys/devices/virtual/thermal/thermal_zone*"):
    try:
        name = open(os.path.join(z, "type")).read().strip()
        out[name] = round(int(open(os.path.join(z, "temp")).read().strip()) / 1000, 1)
    except (OSError, ValueError):
        continue
print(json.dumps(out))
PY
}

NVPMODEL="$(nvpmodel -q 2>/dev/null | head -1 | cut -d: -f2 | xargs || true)"
GPU_CUR="$(read_sys /sys/class/devfreq/17000000.gpu/cur_freq)"
GPU_MAX="$(read_sys /sys/class/devfreq/17000000.gpu/max_freq)"
THERMAL="$(thermal_json)"
MEM_AVAILABLE_MB="$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo 2>/dev/null || echo null)"
SWAP_USED_MB="$(awk '/SwapTotal/{t=$2} /SwapFree/{f=$2} END{print int((t-f)/1024)}' /proc/meminfo 2>/dev/null || echo null)"
LOAD1="$(cut -d' ' -f1 /proc/loadavg 2>/dev/null || echo null)"
SERVICES="$(for u in domia llama-server; do printf '%s=%s ' "$u" "$(systemctl is-active "$u" 2>/dev/null || echo unknown)"; done; printf 'nemo-speech=%s' "$(systemctl --user is-active nemo-speech 2>/dev/null || echo unknown)")"
LLAMA_PID="$(pgrep -x llama-server 2>/dev/null | head -1 || true)"
if [ -n "$LLAMA_PID" ] && [ -r "/proc/$LLAMA_PID/cmdline" ]; then
  LLAMA_ARGS="$(tr '\0' ' ' < "/proc/$LLAMA_PID/cmdline")"
  LLAMA_RSS_MB="$(awk '/VmRSS/{print int($2/1024)}' "/proc/$LLAMA_PID/status")"
elif [ -n "$LLAMA_PID" ]; then
  LLAMA_ARGS="$(ps -o command= -p "$LLAMA_PID" 2>/dev/null || true)"
  LLAMA_RSS_MB="$(ps -o rss= -p "$LLAMA_PID" 2>/dev/null | awk '{print int($1/1024)}' || echo null)"
else
  LLAMA_ARGS=""; LLAMA_RSS_MB=null
fi

python3 - "$LABEL" "$OUT" "$TMP" "$RUNS" "$PARALLEL" "$NVPMODEL" "$GPU_CUR" "$GPU_MAX" "$THERMAL" "$MEM_AVAILABLE_MB" "$SWAP_USED_MB" "$LOAD1" "$SERVICES" "$LLAMA_ARGS" "$LLAMA_RSS_MB" <<'PY'
import json, statistics, sys, datetime
label, out, tmp, runs, parallel, nvpmodel, gpu_cur, gpu_max, thermal, mem_avail, swap_used, load1, services, llama_args, llama_rss = sys.argv[1:]
runs, parallel = int(runs), int(parallel)

def timings(path):
    with open(path) as f:
        return json.load(f).get("timings", {})

prefill = [timings(f"{tmp}/prefill-{i}.json") for i in range(1, runs + 1)]
decode = [timings(f"{tmp}/decode-{i}.json") for i in range(1, runs + 1)]
par = [timings(f"{tmp}/parallel-{i}.json") for i in range(1, parallel + 1)] if parallel > 1 else []
props = json.load(open(f"{tmp}/props.json"))

def p50(values):
    values = [v for v in values if isinstance(v, (int, float))]
    return round(statistics.median(values), 1) if values else None

def num(s):
    try:
        return float(s)
    except ValueError:
        return None

thermal = json.loads(thermal) if thermal else {}
gpu_cur_mhz = num(gpu_cur) / 1e6 if num(gpu_cur) else None
gpu_max_mhz = num(gpu_max) / 1e6 if num(gpu_max) else None
warnings = []
if nvpmodel and not nvpmodel.startswith("MAXN"):
    warnings.append(f"power mode {nvpmodel} is not MAXN")
if gpu_cur_mhz and gpu_max_mhz and gpu_cur_mhz < gpu_max_mhz * 0.9:
    warnings.append(f"gpu clock {gpu_cur_mhz:.0f} MHz below max {gpu_max_mhz:.0f} MHz at the end of the run (clocks not pinned)")
hot = {k: v for k, v in thermal.items() if v >= 85}
if hot:
    warnings.append(f"thermal zones at or above 85C: {hot}")
if num(swap_used) and num(swap_used) > 1024:
    warnings.append(f"{swap_used} MB of swap in use")
if num(load1) and num(load1) > 4:
    warnings.append(f"load average {load1} — other work running")

result = {
    "label": label,
    "at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
    "model": props.get("model_path"),
    "server": {"total_slots": props.get("total_slots"), "n_ctx": (props.get("default_generation_settings") or {}).get("n_ctx"), "args": llama_args.strip(), "rss_mb": num(llama_rss)},
    "box": {"nvpmodel": nvpmodel or None, "gpu_mhz": gpu_cur_mhz, "gpu_max_mhz": gpu_max_mhz, "thermal_c": thermal, "mem_available_mb": num(mem_avail), "swap_used_mb": num(swap_used), "load1": num(load1), "services": services},
    "prefill": {"prompt_tokens": p50([t.get("prompt_n") for t in prefill]), "tok_s_p50": p50([t.get("prompt_per_second") for t in prefill]), "tok_s_min": min([t.get("prompt_per_second", 0) for t in prefill] or [0]), "ms_p50": p50([t.get("prompt_ms") for t in prefill])},
    "decode": {"tokens": p50([t.get("predicted_n") for t in decode]), "tok_s_p50": p50([t.get("predicted_per_second") for t in decode]), "tok_s_min": min([t.get("predicted_per_second", 0) for t in decode] or [0])},
    "parallel": {"streams": parallel, "aggregate_tok_s": round(sum(t.get("predicted_per_second", 0) for t in par), 1), "per_stream_tok_s": [round(t.get("predicted_per_second", 0), 1) for t in par]} if par else None,
    "warnings": warnings,
}
json.dump(result, open(out, "w"), indent=2)
print(f"prefill {result['prefill']['tok_s_p50']} tok/s ({result['prefill']['prompt_tokens']} tok) | decode {result['decode']['tok_s_p50']} tok/s (min {round(result['decode']['tok_s_min'],1)}) | parallel x{parallel} {result['parallel']['aggregate_tok_s'] if result['parallel'] else '-'} tok/s aggregate | gpu {gpu_cur_mhz and round(gpu_cur_mhz)}/{gpu_max_mhz and round(gpu_max_mhz)} MHz | {nvpmodel or '?'} | tj {thermal.get('tj-thermal', '?')}C | rss {llama_rss} MB")
for w in warnings:
    print(f"⚠️ {w}")
print(f"→ {out}")
PY
