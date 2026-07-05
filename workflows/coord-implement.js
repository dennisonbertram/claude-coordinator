export const meta = {
  name: 'coord-implement',
  description: 'Implement a batch of task contracts: route by type, isolate worktrees, schema-validate, check TDD evidence, record artifacts',
  whenToUse: 'Coordinator delegate+integrate phases, when two or more independent task contracts are ready for parallel execution',
  phases: [
    { title: 'Implement', detail: 'one worker per task, routed by task type' },
    { title: 'Record', detail: 'scribe writes .coord/tasks/ artifacts and updates the ledger' },
  ],
}

// args: {
//   tasks: [ { task_id, type, contract } ]   — contract is the full task-contract object
//            type ∈ feature | bugfix | refactor | test | investigation
//   repo_root: string                        — absolute path of the project
// }

// Callers sometimes deliver args as a JSON-encoded string — parse defensively.
const input = typeof args === 'string' ? JSON.parse(args) : args
if (!input || !Array.isArray(input.tasks) || input.tasks.length === 0) {
  throw new Error('coord-implement requires input.tasks (non-empty array of {task_id, type, contract})')
}
if (!input.repo_root) throw new Error('coord-implement requires input.repo_root (absolute project path)')

const ROUTE = {
  feature:       { agentType: 'worker',               effort: 'high',   isolation: 'worktree', tdd: true },
  bugfix:        { agentType: 'worker',               effort: 'high',   isolation: 'worktree', tdd: true },
  refactor:      { agentType: 'worker-refactor',      effort: 'medium', isolation: 'worktree', tdd: false },
  test:          { agentType: 'worker-test',          effort: 'medium', isolation: 'worktree', tdd: false },
  investigation: { agentType: 'worker-investigation', effort: 'high',   isolation: undefined,  tdd: false },
}

// Slim result contract — the load-bearing fields the coordinator consumes.
// Workers still produce their full canonical shape per schemas/<agent>-output.schema.json;
// this schema is what the workflow validates mechanically at the tool layer.
const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  required: ['task_id', 'task_type', 'status', 'scope_completed', 'files_changed', 'summary'],
  properties: {
    task_id: { type: 'string' },
    task_type: { type: 'string', enum: ['feature', 'bugfix', 'refactor', 'test', 'investigation'] },
    status: { type: 'string', enum: ['complete', 'blocked', 'failed'] },
    scope_completed: { type: 'array', items: { type: 'string' } },
    files_changed: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    audit_trail_commits: {
      type: 'object',
      additionalProperties: true,
      properties: {
        red:        { type: 'object', properties: { hash: { type: 'string' }, subject: { type: 'string' } } },
        green:      { type: 'object', properties: { hash: { type: 'string' }, subject: { type: 'string' } } },
        regression: { type: 'object', properties: { hash: { type: 'string' }, subject: { type: 'string' } } },
      },
    },
    tdd_evidence: {
      type: 'object',
      additionalProperties: true,
      properties: {
        failing_before_implementation: { type: 'string' },
        passing_after_implementation: { type: 'string' },
        full_suite_at_regression: { type: 'string' },
      },
    },
    behavioral_tests: { type: 'array' },
    regression_tests: { type: 'array' },
    test_evidence_before: { type: 'string' },
    test_evidence_after: { type: 'string' },
    risks_or_blockers: { type: 'array', items: { type: 'string' } },
    recommended_next_step: { type: 'string' },
  },
}

// Deterministic semantic gate — the checks the coordinator used to re-delegate for.
function semanticError(task, out) {
  if (!out) return 'worker returned no output'
  if (out.status !== 'complete') return null // blocked/failed are legitimate outcomes, surfaced as-is
  const spec = ROUTE[task.type]
  if (spec.tdd) {
    const c = out.audit_trail_commits || {}
    for (const k of ['red', 'green', 'regression']) {
      if (!c[k] || !c[k].hash || c[k].hash.trim() === '') {
        return `missing audit-trail ${k}-commit hash (required for TDD task type '${task.type}')`
      }
    }
    const ev = out.tdd_evidence || {}
    if (!ev.failing_before_implementation || ev.failing_before_implementation.trim() === '') {
      return 'tdd_evidence.failing_before_implementation is empty — red-phase test output is required'
    }
    if (!Array.isArray(out.behavioral_tests) || out.behavioral_tests.length === 0) {
      return 'behavioral_tests is empty — every TDD task must map its contract behavioral tests to results'
    }
  }
  if (task.type === 'refactor') {
    if (!out.test_evidence_before || !out.test_evidence_after) {
      return 'refactor tasks must include test_evidence_before and test_evidence_after (suite passing both times)'
    }
  }
  return null
}

function taskPrompt(task) {
  return [
    `You are executing one coordinator task in the repo at ${input.repo_root}.`,
    `Follow your agent instructions exactly (task type: ${task.type}).`,
    `Task contract (authoritative — respect allowed_files/forbidden_files):`,
    JSON.stringify(task.contract, null, 2),
    ``,
    `Return the load-bearing result object: task_id, task_type, status (complete|blocked|failed),`,
    `scope_completed, files_changed (absolute paths), summary, and — where your agent instructions`,
    `require them — audit_trail_commits, tdd_evidence, behavioral_tests, regression_tests,`,
    `test_evidence_before/after, risks_or_blockers, recommended_next_step.`,
    `If you cannot complete the task within the contract, return status "blocked" with the reason`,
    `in summary — do not improvise outside allowed_files.`,
  ].join('\n')
}

phase('Implement')
log(`Implementing ${input.tasks.length} task(s)`)

const results = await pipeline(
  input.tasks,
  // Stage 1: implement, with one evidence-driven retry
  async (task) => {
    const spec = ROUTE[task.type]
    if (!spec) return { task, output: null, gate_error: `unknown task type '${task.type}'` }
    const opts = {
      agentType: spec.agentType,
      effort: spec.effort,
      schema: RESULT_SCHEMA,
      label: `${task.type}:${task.task_id}`,
      phase: 'Implement',
    }
    if (spec.isolation) opts.isolation = spec.isolation
    let out = await agent(taskPrompt(task), opts)
    let err = semanticError(task, out)
    if (err) {
      log(`${task.task_id}: rejected (${err}) — re-delegating once with the validation error`)
      out = await agent(
        taskPrompt(task) +
          `\n\nYOUR PREVIOUS ATTEMPT WAS REJECTED. Validation error: ${err}\n` +
          `Previous output for reference:\n${JSON.stringify(out)}\n` +
          `Fix the deficiency and return a conforming result.`,
        { ...opts, label: `retry:${task.task_id}` },
      )
      err = semanticError(task, out)
    }
    return { task, output: out, gate_error: err }
  },
  // Stage 2: record the artifact via scribe (skips if the worker died entirely)
  async (r, task) => {
    if (!r || !r.output) return r
    await agent(
      `Write the following JSON verbatim to ${input.repo_root}/.coord/tasks/${task.task_id}.json ` +
        `(create parent directories if needed, overwrite if it exists):\n` +
        JSON.stringify(r.output, null, 2),
      { agentType: 'scribe', effort: 'low', label: `record:${task.task_id}`, phase: 'Record' },
    )
    return r
  },
)

phase('Record')
const settled = results.filter(Boolean)
const ledgerLines = settled.map((r) => {
  const status = r.gate_error ? 'failed' : r.output ? (r.output.status === 'complete' ? 'done' : r.output.status) : 'failed'
  return { task_id: r.task.task_id, status, note: r.gate_error || (r.output && r.output.summary) || 'no output' }
})
await agent(
  `Read ${input.repo_root}/.coord/task-ledger.json (create it as {"tasks": []} if missing), then update the ` +
    `status of each of these tasks (add entries for any that are missing) and write the file back:\n` +
    JSON.stringify(ledgerLines, null, 2),
  { agentType: 'scribe', effort: 'low', label: 'ledger-update', phase: 'Record' },
)

const failed = settled.filter((r) => r.gate_error || !r.output || r.output.status === 'failed')
const blocked = settled.filter((r) => r.output && r.output.status === 'blocked' && !r.gate_error)
const done = settled.filter((r) => r.output && r.output.status === 'complete' && !r.gate_error)
log(`Done: ${done.length}, blocked: ${blocked.length}, failed/rejected: ${failed.length}`)

return {
  counts: { done: done.length, blocked: blocked.length, failed: failed.length },
  results: settled.map((r) => ({
    task_id: r.task.task_id,
    type: r.task.type,
    gate_error: r.gate_error,
    output: r.output,
  })),
}
