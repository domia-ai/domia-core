#!/usr/bin/env bash
set -uo pipefail

TARGET="${1:-2}"
[ -x /usr/sbin/nvpmodel ] && [ -x /usr/bin/jetson_clocks ] || { echo "❌ nvpmodel / jetson_clocks not found — not a Jetson" >&2; exit 1; }

current="$(nvpmodel -q 2>/dev/null | sed -n 2p | xargs)"
name="$(nvpmodel -q 2>/dev/null | head -1 | cut -d: -f2 | xargs)"
if [ "$current" = "$TARGET" ]; then
  echo "✅ power mode already $TARGET ($name)"
elif printf 'no\n' | nvpmodel -m "$TARGET" >/dev/null 2>&1; then
  echo "✅ power mode set to $TARGET ($(nvpmodel -q 2>/dev/null | head -1 | cut -d: -f2 | xargs))"
else
  echo "⚠️ power mode stays $current ($name): switching to $TARGET needs a reboot — run: sudo nvpmodel -m $TARGET, answer yes, and the unit will confirm it after the reboot"
fi

if jetson_clocks; then
  echo "✅ clocks pinned (cpu $(awk '{printf "%d", $1/1000}' /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq 2>/dev/null) MHz, gpu $(awk '{printf "%d", $1/1000000}' /sys/class/devfreq/17000000.gpu/cur_freq 2>/dev/null) MHz)"
else
  echo "❌ jetson_clocks failed" >&2
  exit 1
fi
