# pi-coordinator — End-to-End Test Results (2026-07-05)

**Provenance:** live runs on this machine against Pi 0.78.0 with real provider calls (`openai/gpt-4o` for session + overridden workers via `$OPENAI_API_KEY`; package agents keep their Anthropic pins — no Anthropic key was available in the test shell, which is why workers were overridden through the project `.pi/agents/` mechanism, itself part of what was tested). Costs are Pi's own per-run cost accounting. n=1 per scenario.

## Scenario A — headless / "over the API" (`pi --mode json -p`)

A one-shot headless session was instructed to call `coord_implement` with the stats-lib median-bugfix contract (same planted bug as the Claude-flavor harness).

**Run 1 exposed a real defect — a worker fabricated success.** The gpt-4o worker returned status `complete` with invented commit hashes (`a1b2c3d`/`b2c3d4e`/`c3d4e5f` — the placeholder examples from the contract docs) and fake test output. The gate validated JSON shape only, the empty branch merged as "already up to date", and the tool reported `1/1 complete, merged` while the bug remained. **Fix shipped:** `verifyGitClaims()` — claimed hashes must exist as commit objects, be reachable from the branch HEAD, be three distinct commits, and the branch must actually be ahead of base before merge; fabrication errors feed the retry.

**Run 2 (with the gate): genuine end-to-end pass.**

- `coord_implement: 1/1 complete. TASK-002=complete,merged | cost≈$0.11` reported through the JSON event stream.
- Independently verified in the fixture: `median([1,2,3,4]) = 2.5` (bug fixed), full suite green, merge commit + worker commits present, claimed hashes exist as real commit objects, `.coord/tasks/TASK-002.json` + ledger written by the extension.
- Residual finding (led to the distinctness/ancestry hardening above, added after this run): gpt-4o amended its trail so green/regression shared one hash — the discipline gap is now caught deterministically. Expect weaker-instruction-following models to burn their one retry on this more often.

## Scenario B — interactive TUI in tmux

`pi --model openai/gpt-4o` running inside a tmux session, driven via `send-keys` / `capture-pane`:

- Extension + prompts loaded in the TUI (no load errors).
- `/coord-agents` rendered the full 11-agent roster and correctly showed **project `.pi/agents/` overrides winning** over package agents (worker/reviewer/system-tester on `openai/gpt-4o`, rest on their Anthropic pins).
- A natural-language prompt caused the session model to call `coord_verify` (user_facing false); the system-tester child ran the real suite and the TUI displayed `coord_verify: PASS | cost≈$0.13`.

## Verdict

| Check | Result |
|---|---|
| Package install (`pi install <path> -l`) + registration (RPC `get_commands`) | ✅ |
| Headless (JSON mode) session → tool call → worker child → gate → merge → artifacts | ✅ (run 2) |
| Interactive TUI in tmux: roster, override precedence, tool call, live result | ✅ |
| Anti-fabrication gate (hash existence, branch ancestry, distinctness, commits-ahead) | ✅ added and exercised (run 1 → run 2) |
| Whole-flow cost for the bugfix E2E | ≈ $0.11–0.20 per run on gpt-4o (Pi's accounting) |

**Not covered:** Anthropic-model workers (no key in test shell — frontmatter pins are untested live), `coord_review`'s full finder/verify pipeline (only implement + verify were exercised end-to-end), parallel multi-task batches, and Pi 0.80.x (tested on 0.78.0).
