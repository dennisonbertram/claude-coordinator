# Claude Coordinator

**A structured orchestration system for Claude Code that plans, delegates, reviews, and learns.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Claude Code](https://img.shields.io/badge/Claude-Code-blue)](https://claude.ai/code)

---

## What is this?

Claude Coordinator is a set of Claude Code agent definitions that turn Claude into a **structured project manager**. Instead of having a single Claude session try to do everything, this system uses three specialized agents that work together:

- **Coordinator** — The control plane. Plans work, delegates all I/O and implementation to subagents. Has only the Agent tool — cannot read files or run commands directly.
- **Reader** — The eyes. A fast, cheap Haiku-powered agent that reads files, searches codebases, and returns raw content. The coordinator's sole interface to the filesystem.
- **Worker** — The implementer. Receives a strict task contract and executes it. Returns structured results. Follows TDD.
- **Reviewer** — The quality gate. Read-only code reviewer that finds bugs, regressions, missing tests, and security hazards.

The coordinator maintains state across sessions using two mechanisms: machine-readable files in `.coord/` and human-readable files in `docs/`. This means a project can be picked up exactly where it left off, even after days away.

---

## How it works

The coordinator operates as an explicit **7-phase state machine**:

```
intake → plan → delegate → integrate → review → promote-learnings → close
```

| Phase | What happens |
|-------|-------------|
| **intake** | Understand the request. Read context files. Clarify ambiguity before proceeding. |
| **plan** | Break work into delegatable tasks. Define task contracts. Identify dependencies. Write plan to `docs/plans/active-plan.md`. |
| **delegate** | Launch worker subagents with strict task contracts. Enforce no file overlap between concurrent workers. |
| **integrate** | Collect worker results. Validate output contracts were fulfilled. Record artifacts in `.coord/tasks/`. |
| **review** | Spawn reviewer subagents for risky changes. Block progress on `critical` or `high` severity findings. |
| **promote-learnings** | Extract insights from completed work. Stage in `.coord/learning-inbox.jsonl`. Promote at milestone boundaries. |
| **close** | Update milestone state. Write compressed context for next session. Summarize results for user. |

The coordinator can revisit earlier phases when new information invalidates the current plan.

The coordinator delegates all file reads to a **reader** subagent and all file writes to **worker** subagents. It is a pure control plane — it never touches the filesystem directly.

---

## Architecture: Four Agents, Three State Layers

The coordinator is a pure control plane with only the Agent tool. It reads nothing directly — all filesystem access is handled by the reader (for reads) or workers (for writes). This keeps its context clean and its role unambiguous.

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

## Worker Output Format

Every worker must return exactly this structure. The coordinator rejects freeform prose.

```
## Task Result

### Scope Completed
- Added rate-limit middleware with configurable window and max-requests
- Wired middleware into POST /api/auth/login route
- Added regression test for 429 response after limit exceeded

### Files Changed
/absolute/path/apps/server/src/middleware/rate-limit.ts
/absolute/path/apps/server/src/routes/auth.ts
/absolute/path/apps/server/src/routes/auth.test.ts

### Tests Run
apps/server/src/routes/auth.test.ts — 12 passed, 0 failed

### New Invariants or Assumptions
- Rate limit state is in-memory; restarting the server resets all counters
- The 100 req/min limit is hardcoded; make configurable if requirements change

### Risks or Blockers
- No distributed rate limiting — multiple server instances will not share state

### Recommended Next Step
- If horizontal scaling is needed, replace in-memory store with Redis
```

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

After each task completes, the coordinator extracts learnings from the worker's output and appends them to `.coord/learning-inbox.jsonl`:

```json
{"task_id": "TASK-007", "learning": "Bun's sqlite driver closes the connection on process exit — explicit close() is not needed in tests", "category": "practice", "timestamp": "2024-01-15T14:32:00Z"}
{"task_id": "TASK-007", "learning": "Rate limit state is lost on server restart — document this as a known issue", "category": "issue", "timestamp": "2024-01-15T14:32:01Z"}
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

## Customization

### Change model assignments

Edit the frontmatter in `agents/*.md`:

```yaml
---
model: sonnet   # Change to haiku, sonnet, or opus
---
```

The defaults are:
- `opus` — coordinator, coordinator-experimental, reviewer
- `sonnet` — worker, briefer, planner
- `haiku` — scribe

Using `sonnet` for the coordinator or coordinator-experimental saves cost if your sessions are long.

### Add custom phases

The state machine is defined in the coordinator's system prompt. You can add phases by editing `agents/coordinator.md` — for example, adding a `deploy` phase after `close` or a `qa` phase between `integrate` and `review`.

### Adjust review triggers

The review trigger rules are listed in the coordinator's "Review Delegation" section. Edit `agents/coordinator.md` to add or remove trigger conditions.

### Add tools to workers

Workers currently have access to: Read, Edit, Write, Bash, Glob, Grep, Agent. To restrict workers (e.g., no Bash), edit the `tools:` line in `agents/worker.md`.

---

## Directory Structure

```
claude-coordinator/
├── .claude-plugin/
│   └── plugin.json               # Plugin manifest
├── bin/
│   └── claude-coordinator            # CLI launcher (symlinked to PATH by install.sh)
├── agents/
│   ├── coordinator.md             # Stable coordinator (Agent + Read + Glob + Grep)
│   ├── coordinator-experimental.md # Experimental pure-delegation coordinator (Agent-only)
│   ├── briefer.md                 # Context reader and situational analyst (Sonnet)
│   ├── planner.md                 # Task breakdown and architecture planning (Sonnet)
│   ├── worker.md                  # Worker agent (scoped implementer)
│   ├── worker-experimental.md     # Strict TDD worker — proves test-first with failing output
│   ├── reviewer.md                # Reviewer agent (read-only reviewer)
│   ├── ui-tester.md               # Visual quality inspector with browser automation (Sonnet)
│   ├── ux-tester.md               # Usability evaluator with browser automation (Opus)
│   ├── system-tester.md           # Integration and coverage validator (Sonnet)
│   ├── scribe.md                  # Lightweight state writer (Haiku)
│   └── intent-validator.md        # Intent validation against original user request (Opus)
├── templates/
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

**Can I use Sonnet for the coordinator instead of Opus?**

Yes. Edit the `model: opus` line in `agents/coordinator.md` to `model: sonnet`. Sonnet is faster and cheaper. Use Opus when you need more careful reasoning on complex planning problems.

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

## Experimental: Pure-Delegation Architecture

The plugin ships two coordinator modes:

- **`claude --agent coordinator`** — The stable coordinator with direct read access (`Agent + Read + Glob + Grep`). Can read files itself; delegates implementation and writes to workers.
- **`claude --agent coordinator-experimental`** — Pure-delegation coordinator with `Agent` tool only. All I/O — reads, writes, searches — goes through specialized subagents. A strict control plane.

### Ten-Agent Team

| Agent | Model | Tools | Role |
|-------|-------|-------|------|
| coordinator-experimental | Opus | Agent | Pure control plane — routes, decides, delegates |
| briefer | Sonnet | Read, Glob, Grep | Reads context, returns structured briefings |
| planner | Sonnet | Read, Glob, Grep, Agent | Analyzes codebase, produces task breakdowns |
| worker | Sonnet | Full toolset | Implementation with TDD |
| worker-experimental | Sonnet | Full toolset | Strict TDD implementation — must prove test-first with failing test output before coding. All tasks require regression tests. Used by coordinator-experimental instead of worker. |
| reviewer | Opus | Read, Bash, Glob, Grep | Code review with severity ratings (+ GPT-5.4 external review) |
| ui-tester | Sonnet | Read, Bash, Glob, Grep | Visual quality inspector. Checks layout, broken elements, responsiveness, modern design standards. Uses browser automation. (+ Gemini 3.1 visual review) |
| ux-tester | Opus | Read, Bash, Glob, Grep | Usability evaluator. Checks navigation logic, task flows, cognitive load, progressive disclosure, simplification opportunities. Uses browser automation. (+ Gemini 3.1 UX review) |
| system-tester | Sonnet | Read, Bash, Glob, Grep | Integration validator. Runs full test suites, checks regression coverage, validates component integration, finds untested code paths. |
| scribe | Haiku | Read, Write | All state writes (.coord/, docs/) |
| intent-validator | Opus | Read, Glob, Grep | Validates completed work against user's original intent. Foreground only — asks user questions. |

### Session Flow

```
startup:   Briefer reads context → Coordinator receives briefing
intake:    Coordinator captures command intent → Scribe writes intent doc → User confirms
plan:      Planner produces task breakdown → Scribe writes plan
delegate:  Workers execute in parallel (worktree-isolated, strict TDD)
integrate: Validate worker output, check TDD evidence
review:    Reviewer checks code quality
test:      UI tester + UX tester + System tester validate the product
promote:   Scribe records learnings
validate:  Intent-validator confirms work matches user's intent
close:     Scribe writes context packet for next session
```

### Behavioral Testing & Strict TDD

The experimental architecture enforces a rigorous testing discipline:

**Planner produces behavioral test specs** — not "write tests for X" but specific, user-observable behaviors expressed as testable assertions:
- "When a client exceeds 100 requests in 60 seconds, the next request receives HTTP 429"
- "Given a user with no saved addresses, the checkout page shows an 'Add address' prompt"

**Worker must prove TDD** — the `worker-experimental` agent is required to:
1. Write all behavioral tests FIRST
2. Run them and record the FAILING output (proof of test-first)
3. Implement the minimum code to pass
4. Run tests again and record PASSING output
5. Write regression tests for every task type
6. Include all evidence in the structured report

Worker output that lacks TDD evidence (failing test output before implementation) is **rejected and re-delegated**.

**Regression tests for all task types** — not just bugfixes. Features, refactors, and every other task type must include regression tests that answer: "If this work breaks in the future, what test catches it?"

**All tests must be meaningful** — no `expect(true).toBe(true)`, no tests that can't fail, no testing implementation details instead of behavior.

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

The experimental architecture uses multiple AI models for review, leveraging each model's strengths:

| Agent | Primary Model | External Model | Why |
|-------|--------------|---------------|-----|
| **Reviewer** | Claude Opus | GPT-5.4 | Different models catch different code patterns. GPT-5.4 provides an independent second opinion on security, correctness, and edge cases. |
| **UI Tester** | Claude Sonnet | Gemini 3.1 | Gemini's multimodal vision excels at spatial reasoning and layout analysis — ideal for catching visual issues in screenshots. |
| **UX Tester** | Claude Opus | Gemini 3.1 | Gemini can analyze screenshot sequences as visual flows, identifying navigation disconnects between screens. |

External reviews are incorporated into each agent's own findings — not blindly copied. Each agent evaluates external findings and may dismiss false positives.

**Prerequisites:** The `llm` CLI must be installed with GPT-5.4 and Gemini 3.1 models configured. Install via `pip install llm` and add model plugins as needed.

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
- Each agent is optimized for its role and model tier
- Clean separation of concerns: reads, writes, planning, and implementation are fully decoupled
- Scribe (Haiku) keeps state-write costs minimal

**Con:**
- More round-trips — every read or write is an agent spawn
- Higher total token usage than the stable coordinator
- More complex orchestration to reason about and debug

The experimental architecture shares `worker.md` and `reviewer.md` with the stable coordinator. Only the control plane and its supporting cast (briefer, planner, scribe) differ.

### Usage

```bash
claude --agent coordinator-experimental
```

Or select **coordinator-experimental** from the agent picker in Claude Code.

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
