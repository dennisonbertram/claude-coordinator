#!/usr/bin/env bash
set -euo pipefail

# Sum token usage per model across the agent transcripts of one or more Workflow
# runs, and print an API-equivalent cost estimate.
#
# Usage: collect-metrics.sh <transcript-dir> [<transcript-dir> ...]
#
# Reads every agent-*.jsonl in each dir, sums assistant-message usage fields,
# groups by model, and prices at current sticker rates (2026-07, per MTok):
#   fable  $10 in / $50 out | opus $5/$25 | sonnet $3/$15 | haiku $1/$5
#   cache read = 0.1x input rate; cache write (5m) = 1.25x input rate
# NOTE: costs are API-equivalent ESTIMATES. Subscription usage is not billed
# per token; Sonnet 5 intro pricing ($2/$10 through 2026-08-31) would be lower.

command -v jq >/dev/null || { echo "jq required" >&2; exit 2; }

files=()
for dir in "$@"; do
  while IFS= read -r f; do files+=("$f"); done < <(find "$dir" -name 'agent-*.jsonl' 2>/dev/null)
done
if [ "${#files[@]}" -eq 0 ]; then
  echo "No agent-*.jsonl transcripts found under: $*" >&2
  exit 1
fi
echo "Transcripts: ${#files[@]}"

jq -s '
  [ .[] | select(.message.usage != null and .message.model != null) |
    { model: .message.model,
      inp: (.message.usage.input_tokens // 0),
      out: (.message.usage.output_tokens // 0),
      cr:  (.message.usage.cache_read_input_tokens // 0),
      cw:  (.message.usage.cache_creation_input_tokens // 0) } ]
  | group_by(.model)
  | map({ model: .[0].model,
          input: (map(.inp) | add),
          output: (map(.out) | add),
          cache_read: (map(.cr) | add),
          cache_write: (map(.cw) | add),
          api_calls: length })
  | map(. + { rate: (
      if (.model | test("fable"))  then {i: 10, o: 50}
      elif (.model | test("opus"))   then {i: 5,  o: 25}
      elif (.model | test("sonnet")) then {i: 3,  o: 15}
      elif (.model | test("haiku"))  then {i: 1,  o: 5}
      else {i: 0, o: 0} end) })
  | map(. + { est_cost_usd: (
      (.input * .rate.i + .output * .rate.o
       + .cache_read * .rate.i * 0.1
       + .cache_write * .rate.i * 1.25) / 1000000 ) })
  | { per_model: map(del(.rate)),
      total_est_cost_usd: (map(.est_cost_usd) | add),
      total_output_tokens: (map(.output) | add) }
' "${files[@]}"
