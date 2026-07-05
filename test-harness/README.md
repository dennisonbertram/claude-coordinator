# Workflow Test Harness

Exercises the three `workflows/` scripts against a small fixture project and measures **efficiency** (wall-clock, agent count), **cost** (token usage priced at API-equivalent rates), and **quality** (deterministic gate checks + planted-defect detection).

## Fixture: `fixtures/stats-lib`

A dependency-free Node project (`node --test`) with two planted defects:

1. **`median()` even-length bug** — `median([1,2,3,4])` returns `3` instead of `2.5`. The shipped test suite passes despite it. This is the target of the `TASK-002` bugfix contract: the worker must write a *red* test that reproduces it before fixing.
2. **`mean([])` returns `NaN`** — unguarded division by zero. Not referenced by any task; planted for `coord-review` to find on its own.

`TASK-001` is a feature contract (add `percentile()`), file-disjoint from `TASK-002`.

## Running

```bash
# 1. Instantiate the fixture as a fresh git repo (also installs workflows into it)
./test-harness/setup-fixture.sh /tmp/wf-harness/stats-lib

# 2. From a Claude Code session in this repo, invoke the workflows:
#    Workflow({ scriptPath: "workflows/coord-implement.js",
#               args: { repo_root: "/tmp/wf-harness/stats-lib",
#                       tasks: <tasks.json .tasks> } })
#    then coord-review and coord-verify-product against the same repo_root.

# 3. Sum tokens + estimate cost from the run's transcript directory:
./test-harness/collect-metrics.sh <transcriptDir> [...]
```

## What "pass" means

| Check | Verifies |
|-------|----------|
| `npm test` green in the fixture after `coord-implement` | End-to-end implementation correctness |
| `git log` shows `test(red)` → `feat\|fix` → `test(regression)` for both tasks | The TDD gate is real, not self-reported |
| The red commit for TASK-002 contains a failing even-length median test | Bug actually reproduced before fix |
| `.coord/tasks/TASK-00X.json` + updated `.coord/task-ledger.json` exist | In-workflow scribe recording works |
| `coord-review` confirms the `mean([])` NaN defect | Planted-defect detection (recall) |
| `coord-review` dismissed-count > 0 or plausible confirmed set | Adversarial verify filters noise (precision) |
| `coord-verify-product` returns PASS with real test output in evidence | Tester integration |

## Known caveats

- **Shared-repo concurrency:** in production the coordinator runs workers with worktree isolation on the *session* repo. Here the fixture is external to the session, so parallel workers commit to the same fixture clone. Task file scopes are disjoint, but a git `index.lock` collision is possible — if one occurs, that is a real finding about the harness, not the workflow.
- **Cost figures are API-equivalent estimates** computed from transcript token counts at sticker rates (see `collect-metrics.sh` header). Subscription sessions are not billed per token; Sonnet 5 intro pricing would be lower.
- **The external review pass degrades gracefully:** if the `llm` CLI or its models aren't configured on the machine, the external finder returns no findings and records why — the run still completes.
