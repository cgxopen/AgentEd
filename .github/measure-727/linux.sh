#!/usr/bin/env bash
# Throwaway, measure/727 only. Ubuntu 24.04 under Xvfb. $1 names the build: today or after.
set -uo pipefail
BUILD=$1
BIN="$PWD/src-tauri/target/release/agented"
OUT="$PWD/out"
mkdir -p "$OUT"
rm -rf "$HOME/fx727"; python3 -I .github/measure-727/make-fixtures.py "$HOME/fx727" > "$OUT/labels.txt"
FX="$HOME/fx727/docs/index.md"
export DISPLAY=:99
if ! pgrep -x Xvfb >/dev/null; then
  sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0 >/dev/null
  Xvfb :99 -screen 0 1280x1024x24 >/dev/null 2>&1 & sleep 2
  openbox >/dev/null 2>&1 & sleep 2
fi
export WEBKIT_DISABLE_DMABUF_RENDERER=1
[ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ] && eval "$(dbus-launch --sh-syntax)"
note() { echo "$*" | tee -a "$OUT/notes-$BUILD.txt"; }
names() { for w in $(xdotool search --onlyvisible --name . 2>/dev/null); do xdotool getwindowname "$w"; done | sort -u | tr '\n' '|'; }
stop_app() { pkill -9 -f "$BIN" 2>/dev/null; pkill -9 -f WebKit 2>/dev/null; sleep 1; }

if [ "$BUILD" = today ]; then
  note "== instrument checks"
  strace -f -e trace=connect -o "$OUT/strace-known.txt" curl -sI https://example.com -o /dev/null
  note "strace sees curl connect: $(grep -c AF_INET "$OUT/strace-known.txt")"
  "$BIN" "$FX" > /dev/null 2>&1 & sleep 25; stop_app
fi
note "== build $BUILD"
while read -r label; do
  log="$OUT/log-$BUILD-$label.txt"
  strace -f -qq -e trace=connect -o "$OUT/strace-$BUILD-$label.txt" env AGENTED_MEASURE_727_CLICK="$label" "$BIN" "$FX" > "$log" 2>&1 &
  sleep 15
  note "-- $label: windows $(names)"
  grep 'measure-727' "$log" | sed 's/^measure-727: //' | tee -a "$OUT/notes-$BUILD.txt"
  note "   connects not loopback: $(grep AF_INET "$OUT/strace-$BUILD-$label.txt" | grep -vc '127.0.0.1\|::1'); loopback: $(grep AF_INET "$OUT/strace-$BUILD-$label.txt" | grep -c '127.0.0.1\|::1')"
  stop_app
done < "$OUT/labels.txt"
exit 0
