#!/usr/bin/env bash
# Throwaway, measure/727 only. A hosted macOS runner. $1 names the build: today or after.
set -uo pipefail
BUILD=$1
BIN="$PWD/src-tauri/target/release/agented"
OUT="$PWD/out"
mkdir -p "$OUT"
rm -rf "$HOME/fx727"; python3 -I .github/measure-727/make-fixtures.py "$HOME/fx727" > "$OUT/labels.txt"
FX="$HOME/fx727/docs/index.md"
note() { echo "$*" | tee -a "$OUT/notes-$BUILD.txt"; }
as() { osascript -e "$1" 2>&1; }
stop_app() { pkill -9 -f "$BIN" 2>/dev/null; sleep 2; }
apps() { as 'tell application "System Events" to get name of every process whose background only is false' | tr ',' '\n' | sed 's/^ //' | sort | tr '\n' '|'; }

if [ "$BUILD" = today ]; then
  note "== instrument check: System Events lists a known app"
  open -a TextEdit; sleep 4; note "apps with TextEdit: $(apps)"; osascript -e 'tell application "TextEdit" to quit saving no' >/dev/null 2>&1
fi
note "== build $BUILD"
before=$(apps)
while read -r label; do
  log="$OUT/log-$BUILD-$label.txt"
  AGENTED_MEASURE_727_CLICK="$label" "$BIN" "$FX" > "$log" 2>&1 &
  sleep 15
  now=$(apps)
  note "-- $label: apps $( [ "$now" = "$before" ] && echo unchanged || echo "now $now")"
  grep 'measure-727' "$log" | sed 's/^measure-727: //' | tee -a "$OUT/notes-$BUILD.txt"
  stop_app
done < "$OUT/labels.txt"
exit 0
