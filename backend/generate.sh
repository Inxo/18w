#!/usr/bin/env bash
# Generates the 18-words-of-the-day files for ru and th, then rebuilds the
# index.json each language's client uses to list replayable past days.
#
# Never deletes anything: existing dates are simply overwritten with the
# same deterministic content, and dates outside the requested range are
# left untouched.
#
# Usage:
#   ./generate.sh                 # from today, 3 months ahead
#   ./generate.sh 2026-06-01      # from 2026-06-01, 3 months ahead
#   ./generate.sh 2026-06-01 5    # from 2026-06-01, 5 months ahead
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

START_DATE="${1:-$(date -u +%Y-%m-%d)}"
MONTHS="${2:-3}"
END_DATE=$(date -u -d "${START_DATE} +${MONTHS} months" +%Y-%m-%d)

RU_OUT="../days"
TH_OUT="../th/days"
mkdir -p "$RU_OUT" "$TH_OUT"

BIN=$(mktemp)
trap 'rm -f "$BIN"' EXIT
echo "Building wordgen..."
go build -o "$BIN" .

echo "Generating $START_DATE .. $END_DATE (ru + th)"
d="$START_DATE"
count=0
while [[ "$d" < "$END_DATE" || "$d" == "$END_DATE" ]]; do
  "$BIN" -date="$d" -lang=ru -out="$RU_OUT" >/dev/null
  "$BIN" -date="$d" -lang=th -out="$TH_OUT" >/dev/null
  d=$(date -u -d "$d +1 day" +%Y-%m-%d)
  count=$((count + 1))
done

"$BIN" -reindex -out="$RU_OUT"
"$BIN" -reindex -out="$TH_OUT"

echo "Done: $count day(s) generated for ru + th."
