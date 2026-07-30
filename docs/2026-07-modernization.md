# Claude Coordinator Modernization — 2026-07-03

> **Historical note (superseded):** the named workflow scripts described below (`workflows/coord-implement.js`, `coord-review.js`, `coord-verify-product.js`) and `bin/coord-validate` were later removed. The coordinator now authors inline Workflow scripts per phase, passing output schemas via the Workflow `schema` option; `install.sh` no longer installs workflows. See the README for the current architecture.

What changed in this pass, and what it saves. **Provenance discipline:** figures marked *measured* come from live harness runs on 2026-07-03 (n=1 per configuration, token counts summed from agent transcripts, priced at API sticker rates). Figures marked *structural* are rate arithmetic on published pricing. Anything unmeasured says so.

---

## 1. What was accomplished

### Model × effort policy (all 14 agents)

The plugin was pre-Fable and effort-blind (only 2 of 14 agents declared effort). Every agent now pins both:

| Change | Before | After |
|---|---|---|
| coordinator | opus | **fable**, effort high — the one thin, judgment-only role where the $10/$50 tier buys documented capability (long-horizon coherence, parallel sub-agent management) |
| reviewer | opus | opus, **effort xhigh** (Anthropic's recommended setting for Opus coding work) |
| ux-tester | **opus** | **sonnet**, high |
| learning-extractor | **opus** | **sonnet**, high (token-heavy reading, moderate reasoning) |
| workers / planner / testers | sonnet, no effort | sonnet, **medium or high by role** |
| briefer / scribe | haiku, low | unchanged |

Rationale documented in README → *Model & Effort Policy*, including the traps: Sonnet 5 at `xhigh`/`max` can out-cost Opus 4.8 at `high` for similar-or-worse quality (tokenizer ~30% inflation + heavy adaptive thinking — mechanism is Anthropic-documented, the crossover dollar figure is practitioner-reported); Sonnet 5 follows effort literally (escalate the model, don't crank effort); Fable's thinking is always on.

### Workflow layer (new)

Three deterministic scripts (`workflows/`) replace the coordinator's per-task round-trip choreography with one structured result per phase:

- `coord-implement` — routes tasks by type, worktree-isolates, schema-validates at the tool layer, runs the TDD-evidence gate in plain JS with one evidence-driven retry, records `.coord/` artifacts via Haiku scribes
- `coord-review` — parallel coverage-first finders → mechanical dedupe → semantic root-cause consolidation → severity-tiered adversarial verification → verdict
- `coord-verify-product` — system / UI / UX testers in parallel

The coordinator (`tools: Agent, Workflow`) invokes them for fan-out phases; judgment phases (intake, plan approval, foreground intent-validator) stay conversational. Classic per-agent loop remains as the documented fallback.

### External review models refreshed and future-proofed

- Code second opinion: `gpt-5.4` → **`gpt-5.5`** (verified served; the `-o reasoning_effort` flag is rejected by the installed `llm` CLI and was removed from the default invocation). Documented cheap alternatives: **GLM-5.2** and **DeepSeek V4 Pro** via OpenRouter (text-only — code review role only).
- Visual/UX review: bare `gemini-3.1` (not a registered ID) → **`gemini-3.1-pro-preview`**, with `gemini-3.5-flash` as the ~5× cheaper tier.
- **Version numbers removed from schema field names** (`gpt54_external_review` → `external_code_review`, etc.), each with a required `model` field recording what ran. The next model bump is a prompt edit, not a breaking contract change. (This rename is itself the one breaking change in this pass.)

### Test harness (new) — and what it caught

`test-harness/` runs the workflows against a fixture repo with planted defects and measures everything (see `test-harness/RESULTS.md`). Its first run found and fixed four real defects in the workflow layer: stringified-args crash, duplicate-finding Opus verification waste, a strict-schema finder death, and the invalid `llm` flag.

### Strategic assessments (documented, not built)

- **Smithers**: peer durable-workflow runtime, calls model APIs directly (raw API billing, no Claude Code harness) — recommended as a future *unattended* execution tier via a custom SandboxProvider shelling out to `claude`, not a replacement.
- Four untracked schemas (researcher/distiller/evidence-auditor/knowledge-packager) await their agent definitions; tier them Sonnet when authored.

---

## 2. The savings

### Measured (harness runs, API-equivalent estimates, n=1 each)

| What | Number |
|---|---|
| Review workflow optimization (consolidation + tiered verify), same fixture, same args | **$22.96 → $11.37 per review run (−50%)** |
| Opus share of review cost | **$19.16 → $3.04 (−84%)**; 460 → 63 Opus API calls |
| Implement phase (2 TDD tasks end-to-end incl. artifact recording) | **$2.25 total, zero Opus/Fable tokens** |
| Product verification | $0.33, 37 seconds, one Sonnet agent |
| Cache efficiency during runs | ~98% of input tokens served from cache |

Quality held while cost fell: all TDD gates passed with provable git audit trails, and the review still confirmed real defects (10–15 confirmed findings per run, every one reproduced by execution). Caveat, stated plainly: the letter verdict varied between review runs (MEDIUM vs LOW) and the unhinted planted defect was named explicitly in one run but folded into an adjacent cluster in the other — single-run recall is variance-sensitive.

### Structural (rate arithmetic, not workload-measured)

- **ux-tester and learning-extractor demotions**: Opus→Sonnet is $25→$15 per MTok output (−40%) at sticker, −60% under Sonnet 5 intro pricing ($2/$10 through 2026-08-31). Actual dollar impact depends on how often these roles run — not measured.
- **Effort tuning**: four roles dropped to `medium`, which per Anthropic's published mapping ≈ Sonnet 4.6 at `high` (the old default behavior) at lower thinking spend. Unmeasured.
- **Coordinator round-trip elimination**: each workflow-batched phase removes N spawn/read/validate/record round trips from the Fable coordinator's $10/$50 context, replacing them with one structured result. Mechanism is structural; no classic-loop baseline was run to price the delta.

### What this does NOT claim

- No measured before/after for a full coordinator session (the classic-loop baseline wasn't run — it would have cost more than it informed).
- The review workflow is still ~5× the implement cost even after optimization; it should stay gated on risk triggers, not run per wave.
- All dollar figures are API-equivalent estimates from token counts; subscription usage is not billed per token.

---

## 3. Files touched

- `agents/*.md` — 14 frontmatters (model + effort), coordinator workflow wiring, reviewer/ui/ux external-model rewrites
- `workflows/coord-implement.js`, `coord-review.js`, `coord-verify-product.js` — new
- `schemas/reviewer-output.schema.json`, `ui-tester-…`, `ux-tester-…` — version-neutral external-review fields (+ required `model`)
- `test-harness/` — fixture, setup, task contracts, metrics collector, README, RESULTS.md
- `install.sh` — installs workflows into project `.claude/workflows/`
- `README.md` — Model & Effort Policy, Workflow Layer, Multi-Model Review, updated tables
- `.claude-plugin/plugin.json` — description/keywords
