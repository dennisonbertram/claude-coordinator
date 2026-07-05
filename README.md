# Claude Coordinator

**A structured orchestration system for Claude Code that plans, delegates, reviews, and learns.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Claude Code](https://img.shields.io/badge/Claude-Code-blue)](https://claude.ai/code)

---

## What is this?

Claude Coordinator is a set of Claude Code agent definitions that turn Claude into a **structured project manager**. Instead of having a single Claude session try to do everything, this system uses a team of specialized agents working under a pure-delegation control plane:

- **Coordinator** (Fable) — The control plane. Plans work, maintains state, delegates everything, and writes context for the next session. Its only tool is `Agent`. It does not read or write files directly.
- **Briefer** (Haiku) — Reads context files and returns structured briefings. Cheap, fast.
- **Planner** (Sonnet) — Produces task breakdowns with behavioral-test specifications.
- **Worker** (Sonnet) — Strict TDD implementation for `feature` / `bugfix` tasks. Produces an auditable red → green → regression commit trail.
- **Worker-Refactor** (Sonnet) — Behavior-preserving refactors. Existing tests must pass before and after.
- **Worker-Test** (Sonnet) — Adds tests to existing untested code. Mutation-checks its own tests.
- **Worker-Investigation** (Sonnet) — Read-only research. Returns structured findings; writes no code.
- **Reviewer** (Opus) — Read-only code reviewer with severity ratings, plus an external second-model review pass (default GPT-5.5).
- **UI / UX / System Testers** — Validate the built product visually, experientially, and functionally.
- **Intent-Validator** (Opus) — Final quality gate. Compares what was built against the user's original intent. Runs foreground so it can ask the user questions.
- **Learning-Extractor** (Sonnet) — Analyzes task outputs, review findings, AND sub-agent JSONL transcripts to surface code learnings and process learnings (retries, dead ends, scope drift).
- **Scribe** (Haiku) — Writes all state files. Cheap, fast, precise.

The coordinator maintains state across sessions using two mechanisms: machine-readable files in `.coord/` and human-readable files in `docs/`. This means a project can be picked up exactly where it left off, even after days away.

---

## How it works

The coordinator operates as an explicit **10-phase state machine**:

```
startup → intake → plan → delegate → integrate → review → test → promote-learnings → validate → close
```

| Phase | What happens |
|-------|-------------|
| **startup** | Briefer reads `.coord/` and `docs/` to orient the session. Fresh sessions add `.coord/` to `.gitignore` via scribe. |
| **intake** | Capture the user's request as a command-intent doc (verbatim words, interpreted intent, success criteria). User confirms before proceeding. |
| **plan** | Planner produces a task breakdown with behavioral test specs. User approves before delegation. |
| **delegate** | Coordinator submits the task batch to the `coord-implement` workflow, which routes each task to the right worker (worker, worker-refactor, worker-test, worker-investigation) in isolated worktrees. No file overlap between concurrent workers. |
| **integrate** | The workflow returns schema-validated, TDD-gated, already-recorded results. The coordinator judges failures: re-plan, or retry with an escalated model. |
| **review** | The `coord-review` workflow fans out coverage-first finders (correctness, security, concurrency, tests + external second opinion), then adversarially verifies every finding. Critical/high findings block progress. |
| **test** | The `coord-verify-product` workflow runs UI tester, UX tester, and system tester in parallel. UI/UX only run for user-facing changes. |
| **promote-learnings** | Learning-extractor analyzes task artifacts AND sub-agent transcripts to surface code + process learnings. Scribe records accepted candidates to `.coord/learning-inbox.jsonl`. |
| **validate** | Intent-validator (foreground) compares the work against the original intent doc. May ask the user clarifying questions. |
| **close** | Scribe updates the task ledger and writes a context packet for the next session. Coordinator summarizes for the user. |

The coordinator can revisit earlier phases when new information invalidates the current plan.

---

## State Layers

Truth is maintained in three places, each with a different purpose:

### 1. `.coord/` — Machine Operational State

Working memory. Ephemeral, structured, machine-readable.

```
.coord/
├── task-ledger.json          # All tasks: pending, in-flight, blocked, done, failed
├── learning-inbox.jsonl      # Candidate learnings (JSON lines) awaiting promotion
├── context-packet.md         # Compressed session context for continuity
├── tasks/
│   └── TASK-XXX.json         # Per-task artifacts: output, files changed, test results
├── reviews/
│   └── REVIEW-XXX.json       # Per-review artifacts: findings, severity, recommendations
└── milestones/
    └── M-XXX.json            # Milestone summaries: scope, tasks, learnings promoted
```

### 2. GitHub Issues — Durable Public Tracker

Used for work that is real and reviewable, may span sessions, needs collaborator visibility, or represents a tracked decision. Not used for internal coordination bookkeeping.

### 3. `docs/` — Durable Human-Readable Memory

Persists across sessions. Authoritative record of intent, practices, and plans.

```
docs/
├── context/
│   ├── current-intent.md     # What we're building and why
│   ├── repo-practices.md     # Conventions, patterns, and rules
│   └── known-issues.md       # Known problems, workarounds, tech debt
└── plans/
    ├── active-plan.md        # Current execution plan with task breakdown
    └── execution-brief.md    # Scoped brief for the current milestone
```

---

## Installation

### Plugin install (recommended)

```bash
claude plugin install claude-coordinator
```

Or from the repo directly:

```bash
claude --plugin-dir ./claude-coordinator
```

### Manual install (alternative)

If you prefer not to use the plugin system:

```bash
git clone https://github.com/dennisonbertram/claude-coordinator
cd claude-coordinator
./install.sh
```

### Initialize project state

To scaffold the `docs/` and `.coord/` directories in your project:

```bash
./install.sh --init-project
```

### Worktree include list (for projects using worktree isolation)

When the coordinator spawns workers in isolated git worktrees, gitignored files like `.env` and local configs are not present in the worktree. This causes silent failures when workers try to connect to a database, call an API, or read local settings.

To fix this, copy `templates/.worktreeinclude` to your project root and customize it:

```bash
cp /path/to/claude-coordinator/templates/.worktreeinclude .worktreeinclude
```

The file uses gitignore syntax to list which gitignored files should be copied from the main checkout into each worktree before a worker starts. Open it and uncomment any patterns that apply to your project (e.g. `docker-compose.override.yml`, `.service-account.json`).

---

## Usage

### Starting a session

```bash
# If installed via install.sh:
claude-coordinator
```

Or use the full command directly:

```bash
claude --agent coordinator
```

Or select **coordinator** from the agent picker in Claude Code. When installed as a plugin, the agents are automatically available.

### What happens next

1. The coordinator reads `.coord/context-packet.md` (if it exists) and the `docs/` files to orient itself
2. It asks what you want to work on
3. It enters the `intake` phase, clarifies any ambiguity, then transitions to `plan`
4. Workers are spawned with strict task contracts — each in its own isolated worktree
5. Results are integrated, reviewed if needed, and summarized for you
6. At session end, context is written to `.coord/context-packet.md` for next time

---

## Task Contracts

Every task the coordinator delegates includes a complete contract. Workers may not proceed without one.

```json
{
  "title": "Add rate limiting to the auth endpoint",
  "type": "feature",
  "scope": "Add per-IP rate limiting (100 req/min) to POST /api/auth/login using the existing middleware pattern in apps/server/src/middleware/",
  "allowed_files": [
    "apps/server/src/middleware/rate-limit.ts",
    "apps/server/src/routes/auth.ts",
    "apps/server/src/routes/auth.test.ts"
  ],
  "forbidden_files": [
    "apps/server/src/middleware/auth.ts"
  ],
  "dependencies": [],
  "test_requirements": "Write a regression test that confirms requests beyond the rate limit receive 429. Run the full server test suite.",
  "output_contract": "See structured output requirements below"
}
```

### Task type values

| Type | When to use |
|------|-------------|
| `feature` | New capability |
| `bugfix` | Fixing a defect |
| `refactor` | Restructuring without behavior change |
| `test` | Adding or improving test coverage |
| `investigation` | Research, analysis, or exploration |
| `review` | Code review (reviewer agent only) |

---

## Worker Output: JSON Schemas

Every agent returns a **single JSON object** conforming to a JSON Schema (Draft 2020-12). Schemas live in `schemas/` at the repo root and are the canonical contract for each agent's output.

```
schemas/
├── README.md                            # Map of schemas → agents
├── worker-output.schema.json            # Strict TDD output (feature/bugfix)
├── worker-refactor-output.schema.json   # Behavior-preserving refactor
├── worker-test-output.schema.json       # Coverage uplift with mutation-checks
├── worker-investigation-output.schema.json
├── reviewer-output.schema.json
├── intent-validator-output.schema.json
├── learning-extractor-output.schema.json
├── briefer-output.schema.json
├── planner-output.schema.json
├── ui-tester-output.schema.json
├── ux-tester-output.schema.json
├── system-tester-output.schema.json
└── scribe-output.schema.json
```

### Example: `worker` output (TDD `feature`/`bugfix` tasks)

```json
{
  "task_id": "TASK-042",
  "task_type": "feature",
  "scope_completed": [
    "Added rate-limit middleware with configurable window and max-requests",
    "Wired middleware into POST /api/auth/login route"
  ],
  "audit_trail_commits": {
    "red":        { "hash": "a1b2c3d", "subject": "test(red): TASK-042 failing tests for rate-limit" },
    "green":      { "hash": "e4f5g6h", "subject": "feat: TASK-042 implement per-IP rate limiting" },
    "regression": { "hash": "i7j8k9l", "subject": "test(regression): TASK-042 regression coverage" }
  },
  "tdd_evidence": {
    "failing_before_implementation": "FAIL ... ● returns 429 after threshold",
    "passing_after_implementation":  "PASS ... ✓ returns 429 after threshold (12ms)",
    "full_suite_at_regression":      "Test Suites: 12 passed, 12 total"
  },
  "behavioral_tests": [
    { "spec_id": "BT-001", "description": "When client exceeds 100/60s, response is 429", "status": "pass" }
  ],
  "regression_tests": [
    { "test_name": "rate-limit honors Retry-After", "catches": "Dropped Retry-After header" }
  ],
  "files_changed": [
    "/abs/path/apps/server/src/middleware/rate-limit.ts"
  ],
  "invariants_or_assumptions": ["Rate-limit state is in-memory; restart resets counters"],
  "risks_or_blockers": ["No distributed rate limiting"],
  "recommended_next_step": "Replace in-memory store with Redis if horizontal scaling is required."
}
```

### Why JSON Schema instead of a Markdown template

Earlier versions of this project used `### Markdown Headings` as the output contract. Models drifted on heading capitalization, section ordering, and prose-vs-structured content — and "did the worker conform?" became an interpretive check rather than a mechanical one. JSON Schema fixes all three:

- Validation is deterministic. `bin/coord-validate` either succeeds or points at the offending field.
- "Conform to this schema" puts the model in structured-output mode, which is measurably less prone to drift than "fill in this template."
- The output goes straight into `.coord/tasks/TASK-XXX.json` with no Markdown-to-JSON translation step.

### Validating an output

```bash
# From a file
bin/coord-validate worker .coord/tasks/TASK-042.json

# From stdin
cat output.json | bin/coord-validate reviewer -
```

Exit codes: `0` = valid, `1` = invalid (validator prints the failing field path), `2` = usage error or no validator installed. The script prefers `ajv-cli`, falls back to `check-jsonschema`, then to Python's `jsonschema` package.

### Audit-trail commits (worker only)

For `feature` and `bugfix` tasks the `worker` agent additionally produces three commits — `test(red): ...`, `feat|fix: ...`, `test(regression): ...` — so TDD compliance is provable from `git log` independent of the JSON output. The audit-trail commit hashes appear in the JSON under `audit_trail_commits` and are cross-checked by the coordinator during `integrate`.

---

## Review System

The coordinator spawns a reviewer subagent when any of these conditions apply:

- Changes touch security-sensitive code (auth, crypto, permissions, input validation)
- Changes involve concurrency or shared state
- Changes are user-visible (UI, API responses, error messages)
- Changes touch event surfaces, message formats, or API contracts
- Test coverage appears insufficient
- The task was flagged high-risk

### Severity levels

| Level | Meaning | Action |
|-------|---------|--------|
| `critical` | Exploitable vulnerability or data loss | Block. Fix before proceeding. |
| `high` | Likely bug or serious regression | Block. Fix before proceeding. |
| `medium` | Possible issue or missing coverage | Coordinator decides whether to fix now or track |
| `low` | Minor concern or improvement | Note for learning promotion |
| `info` | Observation with no action required | May be promoted as learning |

> Individual findings use these severity levels. The reviewer's overall assessment uses `PASS | LOW | MEDIUM | HIGH | CRITICAL`, where `PASS` means no issues found.

Reviewers return `Approved: YES`, `Approved: NO`, or `Approved: CONDITIONAL` (with explicit conditions listed).

---

## Session Continuity

At the end of every session, the coordinator writes `.coord/context-packet.md` — a compressed summary of:

- Current milestone and progress percentage
- Key decisions made this session
- Open blockers or pending tasks
- State the next session needs to resume correctly

At the start of the next session, the coordinator reads this file first, before anything else. This gives it enough context to resume without re-reading everything from scratch.

You can inspect `.coord/context-packet.md` at any time to see where things stand.

---

## Learning System

The coordinator captures knowledge in a two-stage pipeline:

### Stage 1: Inbox (during tasks)

After each wave of completed tasks, the coordinator spawns a **learning-extractor**. The extractor analyzes:

- `.coord/tasks/TASK-XXX.json` — task artifacts (worker outputs, commit hashes, test results)
- `.coord/reviews/REVIEW-XXX.json` — reviewer findings
- The intent-validator's output (if available)
- **Sub-agent JSONL transcripts** — the raw conversation transcripts of each sub-agent run. These reveal *process* — retries, dead ends, scope drift, confusion — not just results.

It returns structured candidates that include both **code/project learnings** (practices, patterns, issues, decisions) and **process learnings** (where the orchestration itself struggled). The coordinator triages, and the scribe appends accepted candidates to `.coord/learning-inbox.jsonl`:

```json
{"task_id": "TASK-007", "learning": "Bun's sqlite driver closes the connection on process exit — explicit close() is not needed in tests", "category": "practice", "evidence": "TASK-007 worker output 'New Invariants'", "confidence": "high", "timestamp": "2024-01-15T14:32:00Z"}
{"task_id": "TASK-007", "learning": "Workers writing tests for legacy modules stall when no clear mocking guidance exists in the contract", "category": "process", "evidence": "transcript lines 200-240", "confidence": "high", "timestamp": "2024-01-15T14:32:01Z"}
```

### Stage 2: Promotion (at milestone boundaries)

When a milestone completes, the coordinator:

1. Reviews all inbox entries
2. Deduplicates and filters noise
3. Promotes accepted learnings to the right durable file:
   - Conventions and patterns → `docs/context/repo-practices.md`
   - Known problems → `docs/context/known-issues.md`
4. Clears promoted entries from the inbox

This keeps the docs accurate and up-to-date without requiring manual maintenance.

---

## Coordinator Permissions

The coordinator's frontmatter (`tools: Agent`) already restricts it to delegation only — it cannot edit, write, or run shell commands. As a belt-and-suspenders guard, `coordinator-settings.json` also denies those tools at the permissions layer:

```json
{
  "permissions": {
    "deny": ["Edit", "Write", "Bash", "NotebookEdit", "MultiEdit"]
  }
}
```

This ensures the coordinator cannot accidentally modify files or run shell commands directly — all writes and execution must go through worker or scribe subagents. If you need to relax these constraints (for example, to let the coordinator run read-only shell commands for diagnostics), remove the relevant entry from the `deny` list.

Install this file into your project as `.claude/settings.json` (or merge it with an existing settings file) when using the coordinator on a project where you want the permission enforcement applied.

---

## Model & Effort Policy

Every agent pins a model tier **and** a reasoning-effort level in its frontmatter. The assignments follow three rules:

1. **Sonnet is the default execution tier.** Claude Sonnet 5 delivers near-Opus quality on coding and agentic work at $3/$15 per MTok versus Opus 4.8's $5/$25 (introductory $2/$10 through 2026-08-31). All implementation, testing, and analysis roles run Sonnet.
2. **Opus is reserved for roles where reasoning quality is the deliverable.** Code review (Opus 4.8 still clearly leads Sonnet 5 on deep-coding benchmarks such as SWE-bench Pro) and intent validation (one bounded pass per session, so the premium is cheap in absolute terms).
3. **Fable runs the control plane.** The coordinator holds no file contents — briefer reads, scribe writes, workers implement — so its token profile is thin, and its job (decomposition, routing, resolving conflicting subagent reports, long-horizon coherence across many delegation rounds, parallel sub-agent management) is exactly what Claude Fable 5 is strongest at. It is the one role where $10/$50 per MTok buys capability the cheaper tiers don't have.

| Agent | Model | Effort | Rationale |
|-------|-------|--------|-----------|
| coordinator | fable | high | Judgment-only control plane; thin token profile; long-horizon orchestration is Fable's documented strength |
| reviewer | opus | xhigh | Bug-finding recall is the deliverable; `xhigh` is Anthropic's recommended setting for Opus coding/agentic work |
| intent-validator | opus | high | Human-intent judgment, once per session |
| planner | sonnet | high | Intelligence-sensitive, one pass per plan |
| worker | sonnet | high | Correctness-sensitive TDD implementation |
| worker-investigation | sonnet | high | Root-cause reasoning |
| ux-tester | sonnet | high | Judgment-flavored evaluation, backed by an external second opinion |
| learning-extractor | sonnet | high | Token-heavy transcript reading with moderate synthesis — the cost is in the reading, not the reasoning |
| worker-refactor | sonnet | medium | Behavior-preserving; the test suite gates correctness |
| worker-test | sonnet | medium | Bounded, characterization-style work |
| system-tester | sonnet | medium | Runs suites and reports; mostly mechanical |
| ui-tester | sonnet | medium | Browser-driven visual checks |
| briefer | haiku | low | Mechanical reads (Haiku 4.5 has no effort parameter; the field is a forward-compatible no-op) |
| scribe | haiku | low | Mechanical writes (same note) |

### Effort guidance

Effort is the primary depth/cost control on current models (default `high` on Fable 5, Sonnet 5, and Opus 4.8). Two mappings worth knowing, both from Anthropic's docs: Sonnet 5 at `medium` is roughly Sonnet 4.6 at `high`, and Sonnet 5 at `high` is roughly Sonnet 4.6 at `max` — so the `medium` agents above are not "dumbed down" relative to the pre-Sonnet-5 defaults.

### Known traps

- **Don't crank Sonnet to `xhigh`/`max` to rescue a hard task — escalate the model instead.** Sonnet 5's tokenizer produces ~30% more tokens for the same text (Anthropic-documented), and at `xhigh` its adaptive-thinking spend can push real per-task cost to or above Opus 4.8 at `high` for similar or worse quality (practitioner-reported; Anthropic documents the mechanism but publishes no crossover figure). The coordinator escalates hard tasks to `opus` per-invocation instead.
- **Sonnet 5 follows effort literally.** At `low`/`medium` it scopes work to exactly what was asked and can under-think complex problems. Raise effort or escalate the model; don't prompt around it.
- **Fable's thinking is always on**; effort is its only depth control. Anthropic claims Fable at low effort can exceed prior models at `xhigh` — a vendor claim without a published benchmark table, so treat it as a prior, not a guarantee.

### Changing assignments

Edit the frontmatter in `agents/*.md`:

```yaml
---
model: sonnet   # haiku, sonnet, opus, or fable
effort: high    # low, medium, high, xhigh, or max
---
```

If the Fable premium isn't warranted for a routine project, drop the coordinator to `model: opus` — you lose some long-horizon coherence and delegation quality but keep the architecture intact. The coordinator can also override any subagent's model per invocation (`Agent({ model: "opus", ... })`) for genuinely hard tasks.

---

## Workflow Layer

The coordinator is a judgment layer, not a job runner. The mechanical fan-out phases — implement, review, test — run as deterministic **Workflow scripts** shipped in `workflows/` and installed to your project's `.claude/workflows/` by `install.sh --init-project`.

| Workflow | Replaces | What it does |
|----------|----------|--------------|
| `coord-implement` | delegate + integrate choreography | Pipelines the task batch: routes each task to the right worker variant, isolates worktrees, enforces structured output at the tool layer, runs the deterministic TDD-evidence gate (audit-trail commit hashes, non-empty red-phase output) with one evidence-driven retry, records `.coord/tasks/` artifacts and the ledger via scribe |
| `coord-review` | single-reviewer pass | Parallel coverage-first finders per dimension (correctness, security, concurrency, tests, external second opinion), mechanical dedupe, semantic root-cause consolidation, then tiered adversarial verification (Opus `xhigh` for critical/high, Opus `high` for medium, Sonnet for low/info), overall verdict |
| `coord-verify-product` | serial tester spawns | System tester always; UI + UX testers in parallel for user-facing changes; combined verdict |

### Why this matters for cost

Without workflows, every task costs the coordinator a full round trip *in its own context*: spawn worker → read its JSON → spawn a validator → maybe reject and re-delegate → spawn scribe. Each round trip lands in the Fable coordinator's context at the most expensive per-token rate in the system. With workflows, the coordinator submits a batch and receives **one structured result per phase**:

- Schema-validation retries happen at the tool layer against the Sonnet worker — the coordinator never sees malformed output
- The TDD-evidence gate and re-delegation loop run as plain JavaScript, costing zero model tokens
- Artifact recording and ledger updates happen inside the workflow via Haiku scribes
- Failed workflow runs are resumable: completed agent calls return cached results, so a retry only re-runs what changed

What stays with the coordinator (by design): user-facing gates, plan judgment, weighing blocked/failed results, and the foreground intent-validator — workflows run in background and cannot talk to the user.

Judgment agents (planner, intent-validator, learning-extractor) and single tasks still run as direct `Agent` spawns; the classic per-agent loop remains documented in `agents/coordinator.md` as the fallback when workflows aren't installed.

---

## Customization

### Add custom phases

The state machine is defined in the coordinator's system prompt. You can add phases by editing `agents/coordinator.md` — for example, adding a `deploy` phase after `close` or a `qa` phase between `integrate` and `review`.

### Adjust review triggers

The review trigger rules are listed in the coordinator's "Review Delegation" section. Edit `agents/coordinator.md` to add or remove trigger conditions.

### Add tools to workers

Workers have access to: Read, Edit, Write, Bash, Glob, Grep, Agent (except `worker-investigation`, which is read-only: Read, Bash, Glob, Grep). To restrict workers (e.g., no Bash), edit the `tools:` line in the relevant agent file under `agents/`.

---

## Directory Structure

```
claude-coordinator/
├── .claude-plugin/
│   └── plugin.json               # Plugin manifest
├── bin/
│   ├── claude-coordinator         # CLI launcher (symlinked to PATH by install.sh)
│   └── coord-validate             # JSON Schema validator for agent outputs
├── agents/
│   ├── coordinator.md             # Pure-delegation control plane (Agent-only, Fable)
│   ├── briefer.md                 # Context reader and situational analyst (Haiku)
│   ├── planner.md                 # Task breakdown with behavioral-test specs (Sonnet)
│   ├── worker.md                  # Strict TDD implementation with red/green/regression commits (Sonnet)
│   ├── worker-refactor.md         # Behavior-preserving refactors (Sonnet)
│   ├── worker-test.md             # Coverage uplift with mutation-checked tests (Sonnet)
│   ├── worker-investigation.md    # Read-only research, returns findings (Sonnet)
│   ├── reviewer.md                # Read-only code reviewer + external second-model review (Opus)
│   ├── ui-tester.md               # Visual quality inspector + external vision-model review (Sonnet)
│   ├── ux-tester.md               # Usability evaluator + external vision-model review (Sonnet)
│   ├── system-tester.md           # Integration and coverage validator (Sonnet)
│   ├── scribe.md                  # Lightweight state writer (Haiku)
│   ├── intent-validator.md        # Validates work vs. original user intent (Opus)
│   └── learning-extractor.md      # Analyzes outputs + JSONL transcripts for learnings (Sonnet)
├── workflows/                     # Deterministic fan-out scripts (installed to .claude/workflows/)
│   ├── coord-implement.js         # delegate+integrate: route, isolate, validate, TDD-gate, record
│   ├── coord-review.js            # review: parallel finders → dedupe → adversarial verify → verdict
│   └── coord-verify-product.js    # test: system + UI + UX testers in parallel
├── schemas/                       # Canonical JSON Schema contracts for agent outputs
│   ├── README.md
│   ├── worker-output.schema.json
│   ├── worker-refactor-output.schema.json
│   ├── worker-test-output.schema.json
│   ├── worker-investigation-output.schema.json
│   ├── reviewer-output.schema.json
│   ├── intent-validator-output.schema.json
│   ├── learning-extractor-output.schema.json
│   ├── briefer-output.schema.json
│   ├── planner-output.schema.json
│   ├── ui-tester-output.schema.json
│   ├── ux-tester-output.schema.json
│   ├── system-tester-output.schema.json
│   └── scribe-output.schema.json
├── templates/
│   ├── .worktreeinclude              # Files to copy into agent worktrees (env, local configs)
│   ├── docs/
│   │   ├── context/
│   │   │   ├── current-intent.md
│   │   │   ├── repo-practices.md
│   │   │   ├── known-issues.md
│   │   │   └── command-intent.md  # Captured user intent (written at intake, read at validate)
│   │   └── plans/
│   │       ├── active-plan.md
│   │       ├── execution-brief.md
│   │       └── test-spec.md       # Behavioral test specification template
│   └── .coord/
│       ├── task-ledger.json
│       ├── learning-inbox.jsonl
│       └── context-packet.md
├── test-harness/                  # Workflow-layer test harness: fixture repo, task contracts,
│                                  #   metrics collector, and measured results (RESULTS.md)
├── docs/
│   └── 2026-07-modernization.md   # What changed in the 2026-07 modernization and the measured savings
├── coordinator-settings.json      # Claude Code permissions for the coordinator agent
├── install.sh                     # Manual installer / project scaffolding
├── README.md
└── LICENSE
```

When installed into a project with `--init-project`, the `templates/` contents are copied to your project root.

---

## Plugin Development

### Testing locally

```bash
claude --plugin-dir /path/to/claude-coordinator
```

### Publishing

This plugin can be distributed via Claude Code marketplaces. See the [Claude Code plugin docs](https://docs.anthropic.com/en/docs/claude-code) for marketplace setup.

---

## FAQ

**Do I have to run the coordinator on Fable?**

No. Edit the `model: fable` line in `agents/coordinator.md` to `model: opus` (or `sonnet`). Fable is the default because the coordinator is a thin, judgment-only role — long-horizon coherence and parallel-subagent management are its documented strengths, and the coordinator never holds file contents, so the per-token premium applies to a small token volume. For routine projects, Opus is a reasonable cost saving; Sonnet works but gives up planning-judgment quality where it matters most.

**Can I skip the review phase?**

The coordinator only spawns reviewers when trigger conditions are met. For low-risk tasks (docs, simple config changes, minor refactors), no reviewer will be spawned automatically. You can also tell the coordinator "skip review for this task" in the intake phase.

**How do I reset state and start fresh?**

Delete or archive `.coord/` and start a new session. The coordinator will detect the missing directory and initialize it fresh. Your `docs/` files (intent, practices, known issues) persist and will still be read at startup.

**Can multiple people use this on the same project?**

Yes, but `.coord/` is designed for a single active coordinator at a time. If two people run the coordinator concurrently on the same branch, the task ledger can get out of sync. Use separate branches if you need parallel sessions.

**What if a worker returns freeform prose instead of structured output?**

The coordinator is instructed to reject non-conforming output and re-delegate with explicit format instructions. If it happens repeatedly, check that the worker agent file was installed correctly.

**Can I use this with Claude.ai (not Claude Code)?**

The agent files are designed for Claude Code's agent system. They won't work directly in the claude.ai chat interface, but you can copy the system prompt content into a Project instruction or Custom System Prompt as a starting point.

**Why is intent validation separate from code review?**

Code review checks if the code is correct, secure, and well-tested. Intent validation checks if the code is *what the user wanted*. A perfectly implemented feature that doesn't match the user's mental model is still a failure. The intent-validator catches interpretation drift, scope gaps, and assumption mismatches that code review cannot detect.

**Why does the coordinator delegate file reads instead of reading directly?**

This enforces a pure delegation architecture — the coordinator is *only* a control plane. It makes decisions based on information returned by subagents, never by directly accessing the filesystem. This keeps the coordinator's context clean (it only sees what it asked for) and makes the system easier to reason about. The reader uses Haiku, which is fast and cheap, so there's minimal overhead.


---

## Architecture Reference

The coordinator is a pure control plane. Its only tool is `Agent`. It never reads or writes files directly — every operation is delegated to a specialized subagent. This keeps the coordinator's context clean (it sees only what it asked for) and makes the orchestration easy to reason about. The sections below describe the agent team, session flow, and discipline rules in detail.

### The Agent Team

| Agent | Model | Effort | Tools | Role |
|-------|-------|--------|-------|------|
| coordinator | Fable | high | Agent | Pure control plane — routes, decides, delegates |
| briefer | Haiku | low | Read, Glob, Grep | Reads context, returns structured briefings |
| planner | Sonnet | high | Read, Glob, Grep, Agent | Analyzes codebase, produces task breakdowns with behavioral test specs |
| worker | Sonnet | high | Full toolset | Strict TDD for `feature` and `bugfix` tasks. Produces audit-trail commits (red → green → regression). |
| worker-refactor | Sonnet | medium | Full toolset | Behavior-preserving refactors. No new tests; existing suite must pass before and after. |
| worker-test | Sonnet | medium | Full toolset | Adds tests to existing code. Mutation-checks its own tests to ensure they catch real breakage. |
| worker-investigation | Sonnet | high | Read, Bash, Glob, Grep | Read-only research. Returns structured findings; no code edits, no commits. |
| reviewer | Opus | xhigh | Read, Bash, Glob, Grep | Code review with severity ratings (+ external second-model review, default GPT-5.5) |
| ui-tester | Sonnet | medium | Read, Bash, Glob, Grep | Visual quality inspector. Browser automation. (+ external vision-model review) |
| ux-tester | Sonnet | high | Read, Bash, Glob, Grep | Usability evaluator. Browser automation. (+ external vision-model review) |
| system-tester | Sonnet | medium | Read, Bash, Glob, Grep | Integration validator. Full test suites, regression coverage, integration points. |
| scribe | Haiku | low | Read, Write | All state writes (.coord/, docs/) |
| intent-validator | Opus | high | Read, Glob, Grep | Validates completed work against user's original intent. Foreground only — asks user questions. |
| learning-extractor | Sonnet | high | Read, Glob, Grep, Bash | Analyzes task artifacts, reviewer findings, intent-validator output, and sub-agent JSONL transcripts. Surfaces both code learnings and process learnings (retries, dead ends, scope drift). |

### Session Flow

```
startup:   Briefer reads context → Coordinator receives briefing
           (fresh session: Scribe adds .coord/ to .gitignore)
intake:    Coordinator captures command intent → Scribe writes intent doc → User confirms
plan:      Planner produces task breakdown → Scribe writes plan → User approves
delegate:  Workers execute in parallel (worktree-isolated)
           Coordinator routes by task type:
             feature/bugfix → worker        (strict TDD, audit-trail commits)
             refactor       → worker-refactor (before/after test evidence)
             test           → worker-test    (mutation-checked tests)
             investigation  → worker-investigation (read-only findings)
integrate: Validate worker output, check audit-trail commits exist
review:    Reviewer checks code quality (+ external second-model pass)
test:      UI tester + UX tester + System tester validate the product
promote:   Learning-extractor analyzes outputs + transcripts → Scribe records learnings
validate:  Intent-validator confirms work matches user's intent
close:     Scribe writes context packet for next session
```

### Fresh Session Setup

On the very first session in a new project (when `.coord/` does not exist), the experimental coordinator automatically protects ephemeral state from being committed. Before any other action, it spawns the scribe to add `.coord/` to the project's `.gitignore` (creating the file if it doesn't exist). This prevents machine operational state from being accidentally committed to the repository.

### Session Resumption

When `.coord/context-packet.md` exists and references an unfinished intent, the coordinator also reads `docs/context/command-intent.md` during startup so it can resume with complete intent context — not just task state.

### Behavioral Testing & Strict TDD with Audit-Trail Commits

The architecture enforces a rigorous testing discipline backed by git history.

**Planner produces behavioral test specs** — not "write tests for X" but specific, user-observable behaviors expressed as testable assertions:
- "When a client exceeds 100 requests in 60 seconds, the next request receives HTTP 429"
- "Given a user with no saved addresses, the checkout page shows an 'Add address' prompt"

**Worker must prove TDD with three commits** — the `worker` agent (used for `feature` and `bugfix` tasks) is required to:
1. Write all behavioral tests FIRST → run → record the FAILING output → **commit: `test(red): TASK-XXX failing tests for <behavior>`** (with failing output in the message)
2. Implement the minimum code to pass → run → record PASSING output → **commit: `feat|fix: TASK-XXX implement <behavior>`**
3. Write regression tests → run full suite → record full-suite output → **commit: `test(regression): TASK-XXX regression coverage`**

The audit-trail commits make TDD compliance provable from `git log --oneline`:

```
i7j8k9l test(regression): TASK-042 regression coverage
e4f5g6h feat: TASK-042 implement per-IP rate limiting
a1b2c3d test(red): TASK-042 failing tests for rate-limit
```

A reviewer can see immediately that tests came before implementation. The red commit even contains the failing test output as proof.

Worker output that lacks the audit-trail commits (without a documented reason — e.g., the project has no git) is **rejected and re-delegated**.

**Other task types use specialized workers** — refactors, test coverage uplift, and investigations have their own evidence formats. See `agents/worker-refactor.md`, `agents/worker-test.md`, and `agents/worker-investigation.md`.

**All tests must be meaningful** — no `expect(true).toBe(true)`, no tests that can't fail, no testing implementation details instead of behavior. The `worker-test` agent goes further and mutation-checks its own tests to verify they actually catch breakage.

### Three-Layer Testing

After code review passes, three specialized testers validate the product from different angles:

| Tester | Question | Method |
|--------|----------|--------|
| **UI Tester** | Does it look right? | Launches browser, takes screenshots, checks layout/spacing/responsive design, looks for overlapping elements and visual broken-ness |
| **UX Tester** | Does it make sense? | Uses the app as a first-time user, evaluates navigation logic, identifies simplification opportunities, checks progressive disclosure |
| **System Tester** | Does it all work? | Runs full test suites, checks regression coverage, validates integration points, finds untested code paths |

**UI + UX testers use browser automation** (`agent-browser` CLI) to interact with the real running app. They evaluate what the user actually sees and experiences, not what the code claims to do.

**System tester runs real tests** — executes the full suite, captures output, cross-references against the behavioral test spec from the planner.

**Testing only blocks on real issues:**
- **FAIL** → back to delegate phase for fixes
- **NEEDS-WORK** → coordinator decides: fix now or track for later
- **PASS** → proceed to intent validation

UI and UX testing only runs for tasks with user-facing changes. Backend-only work only triggers the system tester.

### Multi-Model Review

The architecture uses multiple AI models for review, leveraging each model family's strengths. External-model choices live in the agent prompts (not in schema field names), so they can be bumped without breaking output contracts — each output records which `model` actually ran.

| Agent | Primary Model | External Model (default) | Why |
|-------|--------------|--------------------------|-----|
| **Reviewer** | Claude Opus | GPT-5.5 | Different model families catch different code patterns; an independent second opinion on security, correctness, and edge cases. |
| **UI Tester** | Claude Sonnet | Gemini 3.1 Pro (`gemini-3.1-pro-preview`) | Gemini's multimodal vision excels at spatial reasoning and layout analysis — ideal for catching visual issues in screenshots. |
| **UX Tester** | Claude Sonnet | Gemini 3.1 Pro (`gemini-3.1-pro-preview`) | Gemini can hold a whole multi-screenshot flow in one context and spot navigation disconnects between screens. |

**Cheap/fast alternative tier** (documented in the agent prompts; swap in when volume matters more than peak capability):

- Code second opinion: **GLM-5.2** (`llm -m openrouter/z-ai/glm-5.2`) — open-weight, reported above GPT-5.5 on SWE-bench Pro at a fraction of the cost (practitioner-reported benchmark; verify against your own diffs). **DeepSeek V4 Pro** (`llm -m openrouter/deepseek/deepseek-v4-pro`) is the cheapest option and strongest on algorithm-heavy diffs.
- Visual/UX review: **Gemini 3.5 Flash** (`gemini-3.5-flash`) — same vision support at a fraction of the Pro price. The open text-only models (GLM-5.2, DeepSeek V4 Pro) cannot do visual review — no vision input.

External reviews are incorporated into each agent's own findings — not blindly copied. Each agent evaluates external findings and may dismiss false positives.

**Prerequisites:** The `llm` CLI (`pip install llm`) with: an OpenAI key for `gpt-5.5` (built into core `llm`); `llm install llm-gemini` + Gemini key for the vision models; optionally `llm install llm-openrouter` + OpenRouter key for GLM-5.2 / DeepSeek V4 Pro. Note: the legacy `llm-deepseek` plugin does not expose V4 models — use OpenRouter or an OpenAI-compatible endpoint config. If a model is missing, agents record `submitted: false` with a skip reason rather than failing.

### Command Intent Capture

At intake, the coordinator writes a `docs/context/command-intent.md` capturing what the user wants — their exact words, the coordinator's interpreted intent, success criteria, the user's mental model, assumptions, and what's explicitly out of scope.

The user confirms the intent document before work begins. This ensures the coordinator and the user agree on what "done" means before any tasks are delegated.

At session end, the **intent-validator** compares the completed work against the original intent document. It reads the actual implementation files (not just summaries), performs a gap analysis across scope, interpretation, assumptions, UX, and completeness — and may ask the user clarifying questions directly.

The validator runs in foreground and can ask the user questions. It returns one of three verdicts:
- **SATISFIED** — Work matches intent. Proceed to close.
- **NEEDS-WORK** — Gaps found. Return to delegate phase with specific remediation tasks.
- **NEEDS-DISCUSSION** — Ambiguity found. Facilitate discussion, update the intent doc, then re-evaluate.

This closes the gap between "task completed" and "user satisfied."

### Tradeoffs

**Pro:**
- Coordinator context stays pristine — it only sees what it asked for
- Each agent is optimized for its role and model tier (Haiku for mechanical I/O, Sonnet for execution, Opus for review judgment, Fable for coordination)
- Clean separation of concerns: reads, writes, planning, implementation, review, and learning are fully decoupled
- Audit-trail commits make TDD compliance verifiable from git history
- Scribe (Haiku) keeps state-write costs minimal

**Con:**
- More round-trips than a single-agent approach (mitigated by the workflow layer, which batches the implement/review/test fan-outs into one structured result per phase)
- Higher total token usage than a single-agent approach
- More complex orchestration to reason about and debug
- TDD audit trail produces more commits per task (3 for feature/bugfix, 2 for test, 1 for refactor)

---

## Further Reading

- **[docs/2026-07-modernization.md](docs/2026-07-modernization.md)** — the 2026-07 modernization: model × effort policy, the workflow layer, external-model refresh, and the measured savings (review workflow cost halved; Opus spend −84%).
- **[test-harness/README.md](test-harness/README.md)** and **[test-harness/RESULTS.md](test-harness/RESULTS.md)** — how the workflow layer is tested and what the live runs measured.

---

## Contributing

Contributions are welcome. Please:

1. Open an issue describing what you want to change before submitting a PR
2. Keep agent file changes backward-compatible where possible (existing `.coord/` state should still be readable)
3. Test your changes by running a real session against a test project
4. Update the README if you change any behavior, output formats, or file structures

---

## License

MIT — see [LICENSE](LICENSE).
