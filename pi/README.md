# pi-coordinator

The [claude-coordinator](https://github.com/dennisonbertram/claude-coordinator) software factory, delivered as a **[Pi](https://pi.dev) Package**: a coordinator toolset for your interactive Pi session that fans out to specialized worker/reviewer/tester agents with TDD gates and schema-validated JSON results.

## How this differs from the Claude Code plugin (installation!)

The two flavors install through **completely different mechanisms** — don't mix them up:

| | Claude Code plugin (repo root) | Pi package (this `pi/` directory) |
|---|---|---|
| Install | `claude plugin install claude-coordinator`, or `./install.sh` (copies `agents/*.md` → `~/.claude/agents/`, workflows → `.claude/workflows/`) | `pi install <source>` — Pi's own package manager; nothing is copied into `~/.claude/` |
| Where things land | `~/.claude/agents/`, project `.claude/workflows/` | Pi's package store; enabled via `~/.pi/agent/settings.json` (global) or `.pi/settings.json` (project, with `-l`) |
| The coordinator | A dedicated **agent** (`claude --agent coordinator`, runs on Fable) | **Your own interactive Pi session** + the `coord_*` tools this package registers — there is no spawned coordinator model |
| Fan-out mechanics | Claude Code `Workflow` scripts + `Agent` tool | The extension spawns `pi --mode json -p --no-session` child processes per worker |
| State writes (`.coord/`) | Haiku scribe agents | Plain TypeScript in the extension — zero tokens |
| Update | `git pull` + re-run `./install.sh` / plugin update | `pi update` |
| Remove | delete from `~/.claude/agents/` | `pi remove <source>` |

### Installing the Pi flavor

```bash
# From a local clone (works today):
git clone https://github.com/dennisonbertram/claude-coordinator
pi install /absolute/path/to/claude-coordinator/pi        # global (all your projects)
pi install /absolute/path/to/claude-coordinator/pi -l     # OR project-local (.pi/settings.json — teammates auto-install)

# Try it for one session without installing:
pi -e /absolute/path/to/claude-coordinator/pi/extensions/coordinator.ts

# Once published to npm (planned):
pi install npm:pi-coordinator
```

`pi install git:github.com/dennisonbertram/claude-coordinator` would install the **repo root** (the Claude plugin, which is not a Pi package) — Pi's git installer targets a package root, and this package lives in the `pi/` subdirectory, so use the local-path form (or the npm form once published).

Verify with `pi list`, then `/coord-agents` inside a session to see the agent roster.

## What you get

- **Tools** (registered in your session): `coord_implement` (parallel task contracts → routed workers in git worktrees → JSON contract + TDD-evidence gate with one retry → serial merge-back → `.coord/` artifacts), `coord_review` (coverage-first finders → dedupe → root-cause consolidation → severity-tiered adversarial verification → PASS..CRITICAL verdict), `coord_verify` (system/UI/UX testers → combined verdict).
- **Agents** (`agents/*.md`, same frontmatter idea as the Claude flavor: name/description/tools/model): planner, worker, worker-refactor, worker-test, worker-investigation, reviewer, system-tester, ui-tester, ux-tester, briefer, learning-extractor. Override or extend per-project by dropping files in `.pi/agents/`.
- **Phase prompts**: `/coord-intake`, `/coord-plan`, `/coord-implement`, `/coord-review`, `/coord-verify`, `/coord-validate` — the state-machine discipline (intent capture, plan approval gate, review triggers, final intent validation) driven through your own session, where the judgment belongs.

Roles the Claude flavor has that this one deliberately drops: **coordinator** (that's you + your session model), **scribe** (artifact recording is deterministic TypeScript here), **intent-validator as an agent** (it must talk to you, so it runs in-session via `/coord-validate`).

## Models & effort

Agent frontmatter pins Anthropic models with thinking levels (`anthropic/claude-sonnet-5:high`, reviewer on `anthropic/claude-opus-4-8:xhigh`) mirroring the Claude flavor's policy — Pi's thinking levels map onto Anthropic's adaptive-thinking effort. Two notes:

- Confirm availability with `pi --list-models sonnet-5`; on an older Pi model registry, edit the frontmatter down to `claude-sonnet-4-6` etc.
- Pi is natively multi-provider: point a worker at an open model by editing one frontmatter line (e.g. `model: deepseek/deepseek-v4-pro` — already in Pi's registry). On Pi, open-model workers are first-class, not just external second opinions.

## Requirements & caveats

- Pi ≥ 0.78 on PATH, git repo for worktree isolation, provider API keys configured in Pi for the models the agents pin.
- Workers run with your full user permissions (Pi has no sandbox) — worktrees isolate the file tree, not the system. Use containers for untrusted work.
- Structured results are a validated convention (fenced JSON + deterministic gate + one retry), not decoding-level enforcement.
- **Status: exercised end-to-end on 2026-07-05** in both headless JSON mode and the interactive TUI (tmux) — a real bugfix flowed through worker spawn → worktree → anti-fabrication gate → merge → artifacts, and `coord_verify` ran live in the TUI. See [`test-harness/RESULTS-pi.md`](../test-harness/RESULTS-pi.md) for the runs, the fabrication incident that motivated the git-claim verification gate, and what remains untested (Anthropic-pinned workers, full `coord_review` pipeline, multi-task batches).
