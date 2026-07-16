#!/usr/bin/env bash
# Capture every store locale with the backdrop trick (see capture-backdrop.mjs).
#   ./run-backdrop-all.sh            # all locales in promo/learn-corpus.json
#   ./run-backdrop-all.sh de ja fr   # only these
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

# locale -> learning-language, resolved from learn-corpus.json (same mapping
# capture-demo.mjs uses). Kept in python: bash assoc arrays need bash 4 and
# macOS ships 3.2.
pairs=$(python3 - "$HERE/../promo/learn-corpus.json" "$@" <<'PY'
import json,sys
CODE={'English':'en','Spanish':'es','French':'fr','German':'de','Italian':'it','Portuguese':'pt',
      'Dutch':'nl','Russian':'ru','Swedish':'sv','Arabic':'ar','Chinese':'zh_CN','Japanese':'ja'}
corpus=json.load(open(sys.argv[1]))
want=set(sys.argv[2:])
for loc,name in corpus.items():
    if loc.startswith('_'): continue
    if want and loc not in want: continue
    learn=CODE.get(name,'en')
    if learn==loc: learn='en'
    print(loc,learn)
PY
)

ok=0; fail=0
while read -r loc learn; do
  [ -z "$loc" ] && continue
  echo "──── $loc (learn=$learn) ────"
  if node "$HERE/capture-backdrop.mjs" --locale "$loc" --learn "$learn" --native "$loc"; then
    ok=$((ok+1)); else fail=$((fail+1)); echo "  ! failed: $loc"; fi
done <<< "$pairs"
echo "done: $ok ok, $fail failed → $HERE/out-live"
