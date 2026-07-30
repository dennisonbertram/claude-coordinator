# Coordinator Test Harness

Exercises the coordinator's inline-authored Workflow scripts (implement, review, product-verify phases) against a small fixture project and measures **efficiency** (wall-clock, agent count), **cost** (token usage priced at API-equivalent rates), and **quality** (deterministic gate checks + planted-defect detection).

## Fixture: `fixtures/stats-lib`

A dependency-free Node project (`node --test`) with two planted defects:

1. **`median()` even-length bug** — `median([1,2,3,4])` returns `3` instead of `2.5`. The shipped test suite passes despite it. This is the target of the `TASK-002` bugfix contract: the worker must write a *red* test that reproduces it before fixing.
2. **`mean([])` returns `NaN`** — unguarded division by zero. Not referenced by any task; planted for the review phase to find on its own.

`TASK-001` is a feature contract (add `percentile()`), file-disjoint from `TASK-002`.

## Running

```bash
# 1. Instantiate the fixture as a fresh git repo
./test-harness/setup-fixture.sh /tmp/wf-harness/stats-lib

# 2. From a Claude Code session in this repo, have the coordinator author an
#    inline implement-batch Workflow script: a pipeline over the .tasks array
#    in tasks.json (repo_root = the instantiated fixture), spawning one worker
#    per task and validating each worker's JSON via the Workflow `schema`
#    option against schemas/worker-output.schema.json.
#    Then run the review phase and the product-verify phase (system-tester)
#    as inline workflows against the same repo_root.

# 3. Sum tokens + estimate cost from the run's transcript directory:
./test-harness/collect-metrics.sh <transcriptDir> [...]
```

## What "pass" means

| Check | Verifies |
|-------|----------|
| `npm test` green in the fixture after the implement phase | End-to-end implementation correctness |
| `git log` shows `test(red)` → `feat\|fix` → `test(regression)` for both tasks | The TDD gate is real, not self-reported |
| The red commit for TASK-002 contains a failing even-length median test | Bug actually reproduced before fix |
| `.coord/tasks/TASK-00X.json` + updated `.coord/task-ledger.json` exist | Scribe recording works |
| The review phase confirms the `mean([])` NaN defect | Planted-defect detection (recall) |
| Review dismissed-count > 0 or plausible confirmed set | Adversarial verify filters noise (precision) |
| The product-verify phase returns PASS with real test output in evidence | Tester integration |

## Known caveats

- **Shared-repo concurrency:** in production the coordinator runs workers with worktree isolation on the *session* repo. Here the fixture is external to the session, so parallel workers commit to the same fixture clone. Task file scopes are disjoint, but a git `index.lock` collision is possible — if one occurs, that is a real finding about the harness, not the workflow.
- **Cost figures are API-equivalent estimates** computed from transcript token counts at sticker rates (see `collect-metrics.sh` header). Subscription sessions are not billed per token; Sonnet 5 intro pricing would be lower.
- **The external second opinion degrades gracefully:** if the codex MCP server isn't available, the reviewer completes on its own analysis and records why — the run still completes.
