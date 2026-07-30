/**
 * pi-coordinator — multi-agent factory workflows for Pi.
 *
 * Registers three tools in the main session:
 *   coord_implement  — parallel workers (one per task contract) in isolated git
 *                      worktrees, JSON result contracts, deterministic TDD gate,
 *                      serial merge-back, .coord/ artifact recording (in TS — zero tokens)
 *   coord_review     — parallel coverage-first finder passes, deterministic dedupe,
 *                      one consolidation pass, tiered adversarial verification
 *   coord_verify     — system / UI / UX tester fan-out with a combined verdict
 *
 * Workers are child `pi --mode json -p --no-session --no-extensions` processes,
 * one per agent role, with role prompts loaded from this package's agents/ dir
 * (project overrides in .pi/agents/). Structured results are returned by the
 * worker as a final fenced ```json block and validated deterministically here;
 * one evidence-driven retry on gate failure.
 *
 * The COORDINATOR is your interactive Pi session: judgment, plan approval, and
 * intent validation stay with you. These tools are the mechanical fan-out only.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

// ---------------------------------------------------------------------------
// Agent definitions (markdown + frontmatter: name/description/tools/model)
// ---------------------------------------------------------------------------

interface AgentDef {
  name: string;
  description: string;
  tools?: string;
  model?: string;
  systemPrompt: string;
  source: string;
}

function packageAgentsDir(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "agents");
}

function parseAgentFile(file: string): AgentDef | null {
  const raw = fs.readFileSync(file, "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const fm: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (kv) fm[kv[1].trim()] = kv[2].trim();
  }
  if (!fm.name) return null;
  return {
    name: fm.name,
    description: fm.description ?? "",
    tools: fm.tools || undefined,
    model: fm.model || undefined,
    systemPrompt: m[2].trim(),
    source: file,
  };
}

function discoverAgents(cwd: string): Map<string, AgentDef> {
  const agents = new Map<string, AgentDef>();
  const dirs = [packageAgentsDir(), path.join(cwd, ".pi", "agents")]; // project overrides win
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) {
      const def = parseAgentFile(path.join(dir, f));
      if (def) agents.set(def.name, def);
    }
  }
  return agents;
}

// ---------------------------------------------------------------------------
// Worker spawning: pi --mode json -p --no-session --no-extensions
// ---------------------------------------------------------------------------

interface WorkerResult {
  ok: boolean;
  finalText: string;
  json: any | null;
  jsonError: string | null;
  exitCode: number | null;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number; turns: number };
  stderrTail: string;
}

interface SpawnOpts {
  agent: AgentDef;
  task: string;
  cwd: string;
  signal?: AbortSignal;
  modelOverride?: string;
  requireJson?: boolean;
}

function extractLastFencedJson(text: string): { json: any | null; error: string | null } {
  const blocks = [...text.matchAll(/```json\s*\n([\s\S]*?)```/g)];
  if (blocks.length === 0) return { json: null, error: "no fenced ```json block in final output" };
  try {
    return { json: JSON.parse(blocks[blocks.length - 1][1]), error: null };
  } catch (e: any) {
    return { json: null, error: `fenced JSON did not parse: ${e.message}` };
  }
}

async function runWorker(opts: SpawnOpts): Promise<WorkerResult> {
  const { agent, task, cwd } = opts;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-coord-"));
  const promptFile = path.join(tmp, "system.md");
  fs.writeFileSync(promptFile, agent.systemPrompt, "utf8");

  const args = ["--mode", "json", "-p", "--no-session", "--no-extensions", "--append-system-prompt", promptFile];
  const model = opts.modelOverride ?? agent.model;
  if (model) args.push("--model", model);
  if (agent.tools) args.push("--tools", agent.tools);
  args.push(task);

  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
  let finalText = "";
  let stderrTail = "";

  const exitCode: number | null = await new Promise((resolve) => {
    const proc = spawn("pi", args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let buf = "";
    const killTimer: { t?: NodeJS.Timeout } = {};
    const onAbort = () => {
      proc.kill("SIGTERM");
      killTimer.t = setTimeout(() => proc.kill("SIGKILL"), 5000);
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    proc.stdout.on("data", (d: Buffer) => {
      buf += d.toString("utf8");
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let ev: any;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (ev.type === "turn_end") usage.turns++;
        if (ev.type === "message_end" && ev.message?.role === "assistant") {
          const u = ev.message.usage ?? {};
          usage.input += u.input ?? 0;
          usage.output += u.output ?? 0;
          usage.cacheRead += u.cacheRead ?? 0;
          usage.cacheWrite += u.cacheWrite ?? 0;
          usage.cost += u.cost?.total ?? 0;
          const text = (ev.message.content ?? [])
            .filter((c: any) => c.type === "text")
            .map((c: any) => c.text)
            .join("\n");
          if (text.trim()) finalText = text;
        }
      }
    });
    proc.stderr.on("data", (d: Buffer) => {
      stderrTail = (stderrTail + d.toString("utf8")).slice(-2000);
    });
    proc.on("close", (code) => {
      opts.signal?.removeEventListener("abort", onAbort);
      if (killTimer.t) clearTimeout(killTimer.t);
      resolve(code);
    });
    proc.on("error", () => resolve(-1));
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  const { json, error } = opts.requireJson === false ? { json: null, error: null } : extractLastFencedJson(finalText);
  return { ok: exitCode === 0, finalText, json, jsonError: error, exitCode, usage, stderrTail };
}

async function mapConcurrent<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(lanes);
  return results;
}

function sumUsage(results: Array<{ usage: WorkerResult["usage"] }>): WorkerResult["usage"] {
  const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
  for (const r of results) {
    total.input += r.usage.input;
    total.output += r.usage.output;
    total.cacheRead += r.usage.cacheRead;
    total.cacheWrite += r.usage.cacheWrite;
    total.cost += r.usage.cost;
    total.turns += r.usage.turns;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Deterministic gates (ported from the Claude flavor's implement-phase workflow logic)
// ---------------------------------------------------------------------------

const TDD_TYPES = new Set(["feature", "bugfix"]);

function resultContractText(taskType: string): string {
  return [
    "End your FINAL message with a single fenced ```json block (nothing after it) containing exactly:",
    "{",
    '  "task_id": string, "task_type": string, "status": "complete"|"blocked"|"failed",',
    '  "scope_completed": string[], "files_changed": string[], "summary": string,',
    TDD_TYPES.has(taskType)
      ? '  "audit_trail_commits": {"red": {"hash","subject"}, "green": {"hash","subject"}, "regression": {"hash","subject"}},\n  "tdd_evidence": {"failing_before_implementation": string, "passing_after_implementation": string, "full_suite_at_regression": string},\n  "behavioral_tests": [{"spec_id","description","status"}],'
      : taskType === "refactor"
        ? '  "test_evidence_before": string, "test_evidence_after": string,'
        : "",
    '  "risks_or_blockers": string[], "recommended_next_step": string',
    "}",
    "Commit hashes and test output must be REAL (taken from git log and the actual runner) — every claim is verified against the repository and fabrication fails the gate.",
  ]
    .filter(Boolean)
    .join("\n");
}

function gateError(taskType: string, out: any): string | null {
  if (!out) return "worker returned no parseable JSON result";
  if (out.status !== "complete") return null; // blocked/failed are legitimate, surfaced as-is
  for (const k of ["task_id", "summary"]) if (typeof out[k] !== "string" || !out[k]) return `missing required field '${k}'`;
  if (!Array.isArray(out.files_changed)) return "files_changed must be an array";
  if (TDD_TYPES.has(taskType)) {
    const c = out.audit_trail_commits ?? {};
    for (const k of ["red", "green", "regression"]) {
      if (!c[k]?.hash || !String(c[k].hash).trim()) return `missing audit-trail ${k}-commit hash (required for TDD task type '${taskType}')`;
    }
    if (!out.tdd_evidence?.failing_before_implementation?.trim()) {
      return "tdd_evidence.failing_before_implementation is empty — red-phase test output is required";
    }
    if (!Array.isArray(out.behavioral_tests) || out.behavioral_tests.length === 0) {
      return "behavioral_tests is empty — map every contract behavioral test to a result";
    }
  }
  if (taskType === "refactor" && (!out.test_evidence_before || !out.test_evidence_after)) {
    return "refactor tasks must include test_evidence_before and test_evidence_after";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Git worktree isolation + serial merge-back (TS, zero tokens)
// ---------------------------------------------------------------------------

async function sh(pi: ExtensionAPI, cwd: string, cmd: string): Promise<{ ok: boolean; out: string }> {
  const r = await pi.exec("bash", ["-lc", `cd ${JSON.stringify(cwd)} && ${cmd}`], { timeout: 60000 });
  return { ok: r.code === 0, out: (r.stdout + r.stderr).trim() };
}

// Workers can fabricate success (observed live: invented commit hashes + fake test
// output). Never trust the JSON's git claims — verify them against the worktree.
async function verifyGitClaims(pi: ExtensionAPI, taskType: string, out: any, workdir: string, baseSha: string): Promise<string | null> {
  if (!out || out.status !== "complete") return null;
  const ahead = await sh(pi, workdir, `git rev-list --count ${baseSha}..HEAD`);
  if (!ahead.ok || parseInt(ahead.out, 10) === 0) {
    return "status is 'complete' but the worktree has NO commits — commit your actual work; do not fabricate results";
  }
  if (TDD_TYPES.has(taskType)) {
    const c = out.audit_trail_commits ?? {};
    const hashes: string[] = [];
    for (const k of ["red", "green", "regression"]) {
      const hash = String(c[k]?.hash ?? "").trim();
      hashes.push(hash);
      const exists = await sh(pi, workdir, `git cat-file -e ${JSON.stringify(hash)}^{commit}`);
      if (!exists.ok) {
        return `claimed ${k}-commit '${hash}' does not exist in the repository — report the REAL hashes from git log, never invented ones`;
      }
      const reachable = await sh(pi, workdir, `git merge-base --is-ancestor ${JSON.stringify(hash)} HEAD`);
      if (!reachable.ok) {
        return `claimed ${k}-commit '${hash}' is not in the branch history (was it amended away?) — the red → green → regression trail must survive on the branch`;
      }
    }
    if (new Set(hashes).size !== 3) {
      return "red, green, and regression must be three DISTINCT commits — do not squash or amend the TDD trail";
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function coordinator(pi: ExtensionAPI) {
  // ----- coord_implement ---------------------------------------------------
  pi.registerTool({
    name: "coord_implement",
    label: "Coordinator: implement task batch",
    description:
      "Execute a batch of task contracts in parallel. Routes each task to the matching specialist agent " +
      "(feature/bugfix→worker, refactor→worker-refactor, test→worker-test, investigation→worker-investigation), " +
      "isolates mutating tasks in git worktrees, enforces the JSON result contract and the TDD-evidence gate " +
      "(one evidence-driven retry), merges passing branches back serially, and records .coord/ artifacts. " +
      "Ensure task file scopes do not overlap before calling.",
    parameters: Type.Object({
      tasks: Type.Array(
        Type.Object({
          task_id: Type.String(),
          type: StringEnum(["feature", "bugfix", "refactor", "test", "investigation"] as const),
          contract: Type.String({ description: "Full task contract as JSON or precise prose: title, scope, allowed_files, forbidden_files, behavioral_tests, regression_test_requirements" }),
        }),
        { minItems: 1, maxItems: 8 },
      ),
    }),
    async execute(_id, params: any, signal, onUpdate, ctx) {
      const cwd = ctx.cwd;
      const agents = discoverAgents(cwd);
      const route: Record<string, string> = {
        feature: "worker",
        bugfix: "worker",
        refactor: "worker-refactor",
        test: "worker-test",
        investigation: "worker-investigation",
      };
      const isGit = (await sh(pi, cwd, "git rev-parse --is-inside-work-tree")).ok;

      const results = await mapConcurrent(params.tasks, 4, async (t: any) => {
        const agent = agents.get(route[t.type]);
        if (!agent) return { task: t, gate_error: `no agent for task type '${t.type}'`, output: null, usage: sumUsage([]), workdir: cwd, merged: false };
        const mutating = t.type !== "investigation";
        let workdir = cwd;
        let branch: string | null = null;
        let baseSha = "";
        if (mutating && isGit) {
          baseSha = (await sh(pi, cwd, "git rev-parse HEAD")).out;
          branch = `wt/${t.task_id}`;
          workdir = path.join(cwd, ".pi-coord", "wt", t.task_id);
          await sh(pi, cwd, `git worktree remove --force ${JSON.stringify(workdir)}; git branch -D ${branch}`); // stale leftovers from prior runs
          const add = await sh(pi, cwd, `git worktree add -b ${branch} ${JSON.stringify(workdir)} HEAD`);
          if (!add.ok) return { task: t, gate_error: `worktree setup failed: ${add.out.slice(0, 300)}`, output: null, usage: sumUsage([]), workdir: cwd, merged: false };
        }
        const taskText = [
          `You are executing one coordinator task (type: ${t.type}) in the repo at ${workdir}.`,
          `Work ONLY inside that directory. Commit your work there as your agent instructions require.`,
          `Task contract (authoritative — respect allowed_files/forbidden_files):`,
          typeof t.contract === "string" ? t.contract : JSON.stringify(t.contract, null, 2),
          "",
          resultContractText(t.type),
        ].join("\n");

        onUpdate?.({ content: [{ type: "text", text: `⏳ ${t.task_id} (${route[t.type]})` }] });
        const fullGate = async (r: WorkerResult) =>
          r.jsonError ?? gateError(t.type, r.json) ?? (branch ? await verifyGitClaims(pi, t.type, r.json, workdir, baseSha) : null);
        let r = await runWorker({ agent, task: taskText, cwd: workdir, signal });
        let err = await fullGate(r);
        if (err) {
          onUpdate?.({ content: [{ type: "text", text: `↻ ${t.task_id} rejected (${err}) — retrying once` }] });
          r = await runWorker({
            agent,
            task: `${taskText}\n\nYOUR PREVIOUS ATTEMPT WAS REJECTED. Validation error: ${err}\nFix the deficiency and return a conforming result. Previous final output:\n${r.finalText.slice(0, 4000)}`,
            cwd: workdir,
            signal,
          });
          err = await fullGate(r);
        }

        let merged = false;
        let mergeNote = "";
        if (branch) {
          if (!err && r.json?.status === "complete") {
            const merge = await sh(pi, cwd, `git merge --no-ff --no-edit ${branch}`);
            merged = merge.ok;
            if (!merge.ok) {
              await sh(pi, cwd, "git merge --abort || true");
              mergeNote = `merge-back failed (conflict?): ${merge.out.slice(0, 300)}`;
            }
          }
          await sh(pi, cwd, `git worktree remove --force ${JSON.stringify(workdir)} || true`);
          if (merged) await sh(pi, cwd, `git branch -d ${branch} || true`);
        }
        return { task: t, gate_error: err ?? (mergeNote || null), output: r.json, usage: r.usage, workdir, merged, finalText: err ? r.finalText.slice(0, 2000) : undefined };
      });

      // Record artifacts + ledger in TypeScript — zero model tokens.
      const coordDir = path.join(cwd, ".coord", "tasks");
      fs.mkdirSync(coordDir, { recursive: true });
      const ledgerPath = path.join(cwd, ".coord", "task-ledger.json");
      let ledger: any = { tasks: [] };
      try {
        ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
      } catch {}
      for (const r of results) {
        if (r.output) fs.writeFileSync(path.join(coordDir, `${r.task.task_id}.json`), JSON.stringify(r.output, null, 2));
        const status = r.gate_error ? "failed" : r.output?.status === "complete" ? "done" : (r.output?.status ?? "failed");
        const entry = { task_id: r.task.task_id, status, note: r.gate_error ?? r.output?.summary ?? "no output" };
        const i = ledger.tasks.findIndex((t: any) => t.task_id === r.task.task_id);
        if (i >= 0) ledger.tasks[i] = entry;
        else ledger.tasks.push(entry);
      }
      fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));

      const done = results.filter((r) => !r.gate_error && r.output?.status === "complete").length;
      const usage = sumUsage(results);
      const summary =
        `coord_implement: ${done}/${results.length} complete. ` +
        results.map((r) => `${r.task.task_id}=${r.gate_error ? `FAILED(${r.gate_error.slice(0, 80)})` : (r.output?.status ?? "?") + (r.merged ? ",merged" : "")}`).join("; ") +
        ` | tokens out=${usage.output} cost≈$${usage.cost.toFixed(2)}`;
      return { content: [{ type: "text", text: summary }], details: { results, usage } };
    },
  });

  // ----- coord_review ------------------------------------------------------
  pi.registerTool({
    name: "coord_review",
    label: "Coordinator: multi-pass code review",
    description:
      "Review a change set: four parallel coverage-first finder passes (correctness, security, concurrency, tests), " +
      "deterministic dedupe, one consolidation pass grouping findings by root cause, then adversarial verification " +
      "of each root cause (thinking level tiered by severity). Returns confirmed findings and a PASS..CRITICAL verdict.",
    parameters: Type.Object({
      scope: Type.String({ description: "What changed: files, commit range, task summaries — reviewers read the actual code" }),
      context: Type.Optional(Type.String()),
    }),
    async execute(_id, params: any, signal, onUpdate, ctx) {
      const cwd = ctx.cwd;
      const agents = discoverAgents(cwd);
      const reviewer = agents.get("reviewer");
      if (!reviewer) throw new Error("reviewer agent definition not found");
      const findingsContract =
        'End your FINAL message with a single fenced ```json block: {"findings": [{"title": string, "severity": "critical"|"high"|"medium"|"low"|"info", "file": string, "description": string, "evidence": string}]}';
      const coverage =
        "Report every issue you find, including uncertain or low-severity ones. Do not filter — a separate adversarial verification step does that. Coverage over precision.";
      const dims: Array<[string, string]> = [
        ["correctness", "logic errors, edge cases, error propagation, broken invariants"],
        ["security", "injection, authz gaps, secrets handling, unsafe input validation"],
        ["concurrency", "races, shared mutable state, async ordering, idempotency"],
        ["tests", "missing/weak tests, assertions that cannot fail, untested branches"],
      ];

      onUpdate?.({ content: [{ type: "text", text: `⏳ ${dims.length} finder passes` }] });
      const finders = await mapConcurrent(dims, 4, ([key, focus]) =>
        runWorker({
          agent: reviewer,
          task: `Review this change set in ${cwd}, focusing ONLY on ${key}: ${focus}.\nChange set: ${params.scope}\n${params.context ? `Context: ${params.context}\n` : ""}${coverage}\nRead the actual files/diffs.\n${findingsContract}`,
          cwd,
          signal,
        }),
      );
      const raw = finders.flatMap((f) => (Array.isArray(f.json?.findings) ? f.json.findings : []));
      const seen = new Set<string>();
      const deduped = raw.filter((f: any) => {
        const key = `${String(f.file ?? "").replace(cwd, "").split(":")[0]}::${String(f.title ?? "").toLowerCase().slice(0, 48)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      let clusters: any[] = deduped.map((f: any) => ({ ...f, members: [f.title] }));
      if (deduped.length > 3) {
        onUpdate?.({ content: [{ type: "text", text: `⏳ consolidating ${deduped.length} findings` }] });
        const cons = await runWorker({
          agent: reviewer,
          modelOverride: reviewer.model?.includes(":") ? reviewer.model.replace(/:[a-z]+$/, ":medium") : reviewer.model,
          task:
            `Cluster these code-review findings by ROOT CAUSE (same defect under different titles = one cluster; distinct defects stay separate; every index appears exactly once).\n` +
            `Findings: ${JSON.stringify(deduped)}\n` +
            'End with a single fenced ```json block: {"clusters": [{"title": string, "severity": "critical"|"high"|"medium"|"low"|"info", "file": string, "description": string, "member_indices": number[]}]}',
          cwd,
          signal,
        });
        if (Array.isArray(cons.json?.clusters) && cons.json.clusters.length > 0) {
          const assigned = new Set<number>();
          clusters = cons.json.clusters
            .map((c: any) => ({
              ...c,
              members: (c.member_indices ?? []).filter((i: number) => !assigned.has(i) && assigned.add(i)).map((i: number) => deduped[i]?.title).filter(Boolean),
            }))
            .filter((c: any) => c.members.length > 0);
          deduped.forEach((f: any, i: number) => {
            if (!assigned.has(i)) clusters.push({ ...f, members: [f.title] });
          });
        }
      }

      onUpdate?.({ content: [{ type: "text", text: `⏳ verifying ${clusters.length} root cause(s)` }] });
      // Tier the thinking level by severity — only when the agent's model declares one
      // (models without a :thinking suffix, e.g. gpt-4o, are used unchanged).
      const tier: Record<string, string> = { critical: ":xhigh", high: ":xhigh", medium: ":high", low: ":medium", info: ":medium" };
      const verified = await mapConcurrent(clusters, 4, (c: any) =>
        runWorker({
          agent: reviewer,
          modelOverride: reviewer.model?.includes(":") ? reviewer.model.replace(/:[a-z]+$/, tier[c.severity] ?? ":high") : reviewer.model,
          task:
            `Adversarially verify this code-review finding in ${cwd}. Default stance: skepticism — try to REFUTE it. Read the actual code; confirm only with concrete evidence of a real defect.\n` +
            `${JSON.stringify(c)}\n` +
            'End with a single fenced ```json block: {"is_real": boolean, "confirmed_severity": "critical"|"high"|"medium"|"low"|"info", "reasoning": string}',
          cwd,
          signal,
        }).then((v) => ({ ...c, verdict: v.json, usage: v.usage })),
      );

      const confirmed = verified
        .filter((f: any) => f.verdict?.is_real)
        .map((f: any) => ({ title: f.title, severity: f.verdict.confirmed_severity, file: f.file, description: f.description, reasoning: f.verdict.reasoning, consolidated_from: f.members }));
      const order = ["critical", "high", "medium", "low", "info"];
      confirmed.sort((a: any, b: any) => order.indexOf(a.severity) - order.indexOf(b.severity));
      const worst = confirmed[0]?.severity ?? null;
      const verdict = worst === "critical" ? "CRITICAL" : worst === "high" ? "HIGH" : worst === "medium" ? "MEDIUM" : worst ? "LOW" : "PASS";
      const usage = sumUsage([...finders, ...verified]);
      return {
        content: [{ type: "text", text: `coord_review: ${verdict} — ${confirmed.length} confirmed, ${verified.length - confirmed.length} dismissed (raw ${raw.length} → ${clusters.length} root causes) | cost≈$${usage.cost.toFixed(2)}` }],
        details: { verdict, approved: verdict === "PASS" || verdict === "LOW" ? "YES" : verdict === "MEDIUM" ? "CONDITIONAL" : "NO", confirmed_findings: confirmed, counts: { raw: raw.length, deduped: deduped.length, root_causes: clusters.length }, usage },
      };
    },
  });

  // ----- coord_verify ------------------------------------------------------
  pi.registerTool({
    name: "coord_verify",
    label: "Coordinator: verify the built product",
    description:
      "Validate the built product: system-tester always (full suites + behavioral-spec cross-reference); ui-tester and " +
      "ux-tester in parallel when user_facing. Returns per-tester reports and an overall PASS/NEEDS-WORK/FAIL verdict.",
    parameters: Type.Object({
      user_facing: Type.Boolean(),
      app: Type.Optional(Type.String({ description: "How to launch/reach the app; required when user_facing" })),
      behavioral_specs: Type.Optional(Type.String()),
      notes: Type.Optional(Type.String()),
    }),
    async execute(_id, params: any, signal, onUpdate, ctx) {
      const cwd = ctx.cwd;
      const agents = discoverAgents(cwd);
      const contract =
        'End your FINAL message with a single fenced ```json block: {"verdict": "PASS"|"NEEDS-WORK"|"FAIL", "issues": [{"severity": "critical"|"major"|"minor", "description": string, "location": string}], "evidence": string (verbatim test output / commands run)}';
      const shared = [`Repo: ${cwd}.`, params.behavioral_specs ? `Behavioral specs to cross-reference:\n${params.behavioral_specs}` : "", params.notes ?? "", contract].filter(Boolean).join("\n");
      const jobs: Array<[string, string]> = [["system-tester", `Run the full automated test suite(s), check regression coverage against the behavioral specs, validate integration points.\n${shared}`]];
      if (params.user_facing) {
        if (!params.app) throw new Error("user_facing verification requires the 'app' parameter");
        jobs.push(["ui-tester", `Launch/reach the app (${params.app}) and visually inspect the UI per your instructions.\n${shared}`]);
        jobs.push(["ux-tester", `Launch/reach the app (${params.app}) and evaluate usability as a first-time user per your instructions.\n${shared}`]);
      }
      onUpdate?.({ content: [{ type: "text", text: `⏳ ${jobs.length} tester(s)` }] });
      const runs = await mapConcurrent(jobs, 3, ([name, task]) => {
        const agent = agents.get(name);
        if (!agent) return Promise.resolve(null as any);
        return runWorker({ agent, task, cwd, signal }).then((r) => ({ tester: name, report: r.json, jsonError: r.jsonError, usage: r.usage }));
      });
      const reports = runs.filter(Boolean);
      const missing = jobs.map(([n]) => n).filter((n) => !reports.find((r: any) => r.tester === n && r.report));
      const verdicts = reports.filter((r: any) => r.report).map((r: any) => r.report.verdict);
      const overall = missing.length || verdicts.includes("FAIL") ? "FAIL" : verdicts.includes("NEEDS-WORK") ? "NEEDS-WORK" : "PASS";
      const usage = sumUsage(reports);
      return {
        content: [{ type: "text", text: `coord_verify: ${overall}${missing.length ? ` (missing: ${missing.join(",")})` : ""} | cost≈$${usage.cost.toFixed(2)}` }],
        details: { overall, reports, missing_testers: missing, usage },
      };
    },
  });

  // ----- /coord-agents command --------------------------------------------
  pi.registerCommand("coord-agents", {
    description: "List coordinator agent definitions (package + .pi/agents overrides)",
    handler: async (_args, ctx) => {
      const agents = discoverAgents(ctx.cwd);
      const lines = [...agents.values()].map((a) => `${a.name}  [${a.model ?? "session default"}]  tools: ${a.tools ?? "all"}  (${a.source})`);
      ctx.ui.notify(lines.join("\n") || "no agents found", "info");
    },
  });
}
