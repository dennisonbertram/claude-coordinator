# Workflow Layer — Harness Results (2026-07-03)

**Provenance:** single live run of each workflow (plus one re-run of `coord-review` after optimization) against the `stats-lib` fixture, executed from a Claude Code session on this machine on 2026-07-03. Token counts summed from the runs' agent transcripts by `collect-metrics.sh`; **dollar figures are API-equivalent estimates at sticker rates** (Sonnet $3/$15, Opus $5/$25, Haiku $1/$5; cache read 0.1×, cache write 1.25×) — subscription usage is not billed per token, and Sonnet 5 intro pricing would be lower. n=1 per configuration; durations and verdicts vary run to run.

## Run summary

| Run | Agents | Duration | Output tokens | Est. cost (API-equiv) | Result |
|-----|--------|----------|---------------|------------------------|--------|
| `coord-implement` (2 tasks: feature + bugfix) | 5 (2 Sonnet workers, 3 Haiku scribes) | 4.6 min | 41K | **$2.25** | 2/2 done, all gates passed |
| `coord-verify-product` (system only) | 1 (Sonnet) | 37 s | 3K | **$0.33** | PASS with verbatim evidence |
| `coord-review` v1 (per-finding Opus `xhigh` verify) | 29 | 8.5 min | 251K | **$22.96** ($19.16 Opus) | MEDIUM / CONDITIONAL, 15 confirmed / 9 dismissed |
| `coord-review` v2 (consolidation + tiered verify) | 18 | 8.9 min | 131K | **$11.37** ($3.04 Opus) | LOW / YES, 10 confirmed / 2 dismissed |

Zero Fable/Opus tokens were spent on the implement and verify-product phases — the entire delegate→integrate→record choreography ran on Sonnet + Haiku.

## Quality gates (implement phase) — all passed, independently verified

- Full suite green after both tasks: 18/18 tests.
- Real TDD audit trail in `git log`: `test(red)` → `feat|fix` → `test(regression)` for both tasks; the red commits contain verbatim failing test output (e.g. `3 !== 2.5` for the planted even-length median bug) — the bug was genuinely reproduced before the fix.
- `.coord/tasks/TASK-00{1,2}.json` artifacts and `task-ledger.json` written correctly by in-workflow scribes.
- No forbidden-file contamination in any final commit (verified via `git show --stat`).

## Planted-defect detection (review phase)

Two defects were planted; neither was hinted at in the review scope.

| Defect | v1 | v2 |
|--------|----|----|
| `median()` even-length bug (fixed by TASK-002; review sees the fix) | v1 confirmed the fix area clean | v2 explicitly fuzz-verified the fix correct |
| `mean([])` → NaN (never mentioned in any task) | **Caught** as its own confirmed finding | **Partially caught** — folded into the "empty-array behavior untested" cluster; not named as its own finding |

Takeaway: recall on unhinted defects is real but **variance-sensitive across runs**. One v2 finder also died (structured-output retry cap; run degraded gracefully as designed) — its findings were lost. Verification rigor was consistently high in both runs: every confirmed finding was reproduced by execution, several finder framings were corrected with evidence, and severity inflation was argued down.

## Defects found in the workflow layer itself (fixed during the harness run)

1. **Args delivered as a JSON-encoded string** crash all three scripts at the guard (0 agents, 0 tokens). Fixed: defensive `JSON.parse` in every script.
2. **Review verify fan-out was the dominant cost** — coverage-first finders rediscover the same root cause under different titles; each duplicate bought a full Opus `xhigh` verification ($19.16 of $22.96). Fixed: normalized dedupe keys + a Sonnet consolidation pass (21 findings → 12 root causes) + severity-tiered verification (Opus `xhigh` only for critical/high). **Measured effect: −50% total cost, −84% Opus spend**, same-order duration.
3. **Strict finder schemas caused a StructuredOutput retry-cap death** (1 of 5 finders in v2). Fixed: finder item schemas now permit additional properties.
4. **`llm -m gpt-5.5 -o reasoning_effort high` errors** ("Extra inputs are not permitted") on the installed `llm` CLI — a verifier agent discovered this mid-run and adapted. Fixed in `agents/reviewer.md`: option removed from the default invocation.
5. **Shared-fixture git race confirmed** (documented harness caveat, not a workflow bug): both parallel workers hit commit interleaving in the shared fixture clone, *detected it themselves*, recovered, and verified their final commits touched only allowed files. In production the coordinator's worktree isolation on the session repo prevents this; the harness accepts it because the fixture lives outside the session repo.

## Open observations (not fixed)

- **Verdict variance:** v1 said MEDIUM/CONDITIONAL, v2 said LOW/YES on the same code. Contributing causes: cluster-level severity judgment, the dead finder, and verifiers reasoning from context ("this is a harness fixture, not production") — severity judgments leak context. For gating decisions, treat the confirmed-findings list as the stable signal and the letter verdict as advisory.
- **Review remains ~5× the cost of implementation** even after optimization ($11.37 vs $2.25 on this fixture). On a 60-line change that ratio is absurd in absolute terms but the fixture is pathological — review cost scales with finding count, not diff size. The coordinator should keep review gated on the risk triggers, not run it per wave by default.
- Cost estimates would be ~2/3 lower for the Sonnet share under intro pricing (through 2026-08-31).
