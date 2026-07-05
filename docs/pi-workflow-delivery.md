# Delivering the Coordinator Workflow on Pi — Research & Design (2026-07-05)

**Provenance:** synthesized from (a) the live GitHub repo/docs/npm registry for `earendil-works/pi` (fetched 2026-07-05; latest release 0.80.3) and (b) the locally installed `@earendil-works/pi-coding-agent` 0.78.0 (docs + `examples/` read directly). Claims from community packages are marked with their adoption level. One fetched GitHub page contained an embedded prompt-injection attempt (fake system instructions); it was recognized and discarded — noted here because it's a live supply-chain hazard when researching this ecosystem with agents.

---

## 1. What Pi is

Pi (`pi.dev`, `@earendil-works/pi-coding-agent`, MIT) is a **minimal terminal coding harness** by Mario Zechner (badlogic) with Armin Ronacher (mitsuhiko) as co-maintainer. TypeScript/Node ≥22, very active (releases every 1–3 days). Its philosophy is the load-bearing fact for us, stated verbatim in its docs:

> "Pi keeps the core small and pushes workflow-specific behavior into extensions, skills, prompt templates, and packages. It intentionally does not include built-in MCP, sub-agents, permission popups, plan mode, to-dos, or background bash."

So a multi-agent workflow is not a gap in Pi — it's **exactly the artifact Pi's design invites third parties to ship**, as a *Pi Package* (npm/git-installable bundle of TypeScript extensions + agent files + prompt templates).

Key primitives (all verified against local install or official docs):

| Primitive | What it gives us |
|---|---|
| **Extensions** (TS modules, hot-reload, no build step) | `registerTool` (TypeBox schema, `terminate:true`), `registerCommand`, ~25 lifecycle events incl. `tool_call` blocking (gates!), `pi.exec`, session spawning (`ctx.newSession/fork`) |
| **Headless modes** | `pi --mode json -p --no-session` (one-shot, typed JSONL event stream incl. usage/cost per message) and `--mode rpc` (long-lived JSONL control: prompt/steer/fork/model/thinking) |
| **SDK** | `createAgentSession({model, tools, customTools, thinkingLevel})` in-process |
| **Skills / prompt templates** | agentskills.io-standard skills (reads `~/.claude/skills` directly!); `.md` → `/command` templates |
| **Model control** | Multi-provider (Anthropic, OpenAI, Google, OpenRouter, Ollama…); thinking levels `off/minimal/low/medium/high/xhigh` that **map onto Anthropic adaptive thinking + `output_config.effort`** on Anthropic models |
| **Pi Packages** | `package.json` with `"pi": {extensions, skills, prompts}`; `pi install npm:…` / `git:…`; project-scoped installs auto-install for teammates |

Pi has **no MCP** (rejected explicitly), **no permission model** (isolation is your container's job), and **no native structured-output flag** — the idiom is a custom tool with a schema + `terminate: true` (the shipped `structured-output.ts` example).

## 2. The decisive discovery: Pi ships our skeleton

The installed package's `examples/extensions/subagent/` is a reference implementation of almost exactly the coordinator pattern:

- **Agents are markdown files with YAML frontmatter `name`, `description`, `tools`, `model`** — discovered from `~/.pi/agent/agents/*.md` and `.pi/agents/*.md`. This is our agent format minus `effort` (Pi spells it `:thinking-level` on the model string).
- **One `subagent` tool with three modes**: `single {agent, task}`, `parallel {tasks[]}` (max 8, concurrency 4), `chain {steps[]}` with `{previous}` substitution and stop-on-failure.
- **Workers are spawned as `pi --mode json -p --no-session --model … --tools … --append-system-prompt …`** child processes; the extension parses the JSONL event stream, aggregates usage/cost per task, and caps model-visible output.
- Sample agents (scout/planner/reviewer/worker) and **workflow prompt templates** (`/implement` = scout→planner→worker chain) are included.
- `structured-output.ts` (sibling example) shows the schema-validated terminating tool — our output-contract mechanism.

Community prior art confirms the shape works but is immature: `pi-workflow-engine` (11★, SDK-based `agent()/parallel()/pipeline()` + worktree isolation — closest analog to our workflow scripts), `pi-orchestration` (2★), `pi-agent-flywheel` (1★). The monorepo's own `pi-orchestrator` package (spawns/supervises `pi --mode rpc` processes, optional `radius.pi.dev` relay) is explicitly **experimental** and handles process lifecycle only — no task graphs, no schemas, no judgment layer.

## 3. Component-by-component fit

| claude-coordinator component | Pi equivalent | Port effort |
|---|---|---|
| 14 agent `.md` files (name/description/tools/model/effort frontmatter) | `agents/*.md` in the subagent format — same fields; `effort: high` → `model: anthropic/claude-sonnet-5:high` (Pi thinking levels project onto Anthropic effort) | **Near 1:1** — frontmatter tweak, prompt bodies port as-is |
| JSON-Schema output contracts + `coord-validate` | Terminating `submit_result` custom tool per agent role: TypeBox parameters (TypeBox *is* JSON Schema at runtime — our schemas translate mechanically; use `StringEnum` for Google-model compat), `terminate: true` skips the trailing prose turn. Validation happens at tool-call time — same layer as our Workflow `schema:` option | Mechanical translation |
| Workflow scripts (`coord-implement/review/verify-product`) | The coordinator extension's tool modes: `parallel` for implement/test fan-outs, `chain` for review find→consolidate→verify, per-task `cwd` pointed at git worktrees we create (no shipped worktree example — we combine `pi.exec("git worktree add …")` with the subagent spawn pattern) | Rewrite in TS against a proven skeleton |
| Coordinator judgment loop (state machine, gates, user approval) | Interactive Pi session with the extension loaded: prompt templates (`/coord-intake`, `/coord-plan`…) drive phases; `tool_call` blocking hooks implement hard gates (e.g., block close until intent validation) | Redesign — Pi's coordinator is the *user's own session*, not a spawned agent |
| `.coord/` + `docs/` state | Keep as plain files (workers already write them); optionally mirror into session via `pi.appendEntry` | Unchanged |
| Reviewer/tester tool restriction | `--tools read,bash` per agent frontmatter | 1:1 |
| Multi-model externals (GPT-5.5/Gemini/GLM/DeepSeek) | Stronger than our `llm`-CLI shim: Pi is natively multi-provider, so a *worker itself* can run on GLM-5.2 or DeepSeek V4 via OpenRouter/models.json — open-model workers become first-class, not just second opinions | Improvement over status quo |

What does **not** transfer: Claude Code's Workflow tool (budget tracking, resume-from-journal, Caliper visibility), the Agent-tool permission model, and our Fable coordinator tier — Pi's coordinator is whatever model the user's session runs.

## 4. Delivery options (ranked)

1. **RECOMMENDED — ship a Pi Package: `pi-coordinator`.** Fork the `subagent/` skeleton into a package containing: (a) a `coordinator` extension exposing the fan-out tool (parallel/chain, per-task worktree `cwd`, usage/cost aggregation) plus per-role `submit_result` terminating tools carrying our translated schemas and the deterministic TDD-evidence gate in TS; (b) our 14 agent definitions converted to Pi agent `.md` format; (c) prompt templates for the phase flow (`/coord-intake`, `/coord-plan`, `/coord-implement`, `/coord-review`, `/coord-validate`); (d) optionally our skills verbatim (Pi reads Claude-format skills). Distribute via `pi install git:github.com/dennisonbertram/pi-coordinator` or npm. **Estimated scope: a focused 1–2 day build** — the skeleton, spawn mechanics, and JSONL parsing already exist as shipped example code.
2. **External orchestrator over headless Pi** (SDK in-process, or `pi --mode rpc` child processes) — for an unattended factory driving Pi workers from outside. More engineering (JSONL framing, no UI), overlaps with the Smithers direction; do it later if the headless need materializes.
3. **Skills/prompt-template content port only** — hours of work, content parity, no orchestration. Only worth it as a teaser alongside option 1.

## 5. Risks & caveats

- **API churn**: Pi releases every 1–3 days (0.78 local vs 0.80.3 latest); extension API is comparatively stable but pin versions and expect maintenance. `pi-orchestrator` is explicitly "may change or be removed" — don't build on it.
- **No sandbox**: Pi extensions and workers run with full user permissions; parallel `bash`-wielding workers should run in worktrees at minimum, containers ideally.
- **Structured output is convention, not decoding-level enforcement** — the terminating-tool pattern validates at the tool layer (same guarantee level we rely on in Claude Code workflows), but a model can still fail to call the tool; our retry-on-gate-failure pattern ports.
- **Ecosystem trust**: community orchestration packages are 1–11★ proofs of concept; the repo's GitHub star count could not be corroborated as organic; and we observed a live prompt-injection attempt in fetched page content during research. Treat third-party Pi packages as code you audit before installing — they are unsandboxed TypeScript.
- Anthropic-specific niceties (Fable tier, `xhigh` on Anthropic models, prompt-cache economics) depend on Pi's per-provider mapping — verify `thinkingLevelMap` behavior on the exact models before promising effort parity.
