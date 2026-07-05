export const meta = {
  name: 'coord-verify-product',
  description: 'Validate the built product: system tests always; UI and UX testers in parallel for user-facing changes',
  whenToUse: 'Coordinator test phase, after review passes',
  phases: [{ title: 'Test', detail: 'system / UI / UX testers in parallel' }],
}

// args: {
//   repo_root: string          — absolute path of the project
//   user_facing: boolean       — run ui-tester + ux-tester as well as system-tester
//   app: string                — how to launch/reach the running app (command or URL); required if user_facing
//   behavioral_specs: string   — behavioral test specs from the planner, for cross-referencing
//   notes: string              — optional extra context
// }

// Callers sometimes deliver args as a JSON-encoded string — parse defensively.
const input = typeof args === 'string' ? JSON.parse(args) : args
if (!input || !input.repo_root) throw new Error('coord-verify-product requires args.repo_root')
if (input.user_facing && !input.app) throw new Error('user_facing runs need args.app (launch command or URL)')

const TESTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'issues', 'evidence'],
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'NEEDS-WORK', 'FAIL'] },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'description'],
        properties: {
          severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
          description: { type: 'string' },
          location: { type: 'string' },
          fix_hint: { type: 'string' },
        },
      },
    },
    evidence: { type: 'string' },
  },
}

const shared = [
  `Repo: ${input.repo_root}.`,
  input.behavioral_specs ? `Behavioral specs to cross-reference:\n${input.behavioral_specs}` : '',
  input.notes ? `Notes: ${input.notes}` : '',
  `Follow your agent instructions. Return verdict PASS | NEEDS-WORK | FAIL with concrete issues and verbatim evidence (test output, screenshots taken, commands run).`,
].filter(Boolean).join('\n')

phase('Test')
const thunks = [
  () =>
    agent(
      `Run the full automated test suite(s), check regression coverage against the behavioral specs, and validate integration points.\n${shared}`,
      { agentType: 'system-tester', effort: 'medium', schema: TESTER_SCHEMA, label: 'system-tester', phase: 'Test' },
    ),
]
if (input.user_facing) {
  thunks.push(() =>
    agent(
      `Launch/reach the app (${input.app}) and visually inspect the UI per your agent instructions (layout, broken elements, responsiveness, design quality).\n${shared}`,
      { agentType: 'ui-tester', effort: 'medium', schema: TESTER_SCHEMA, label: 'ui-tester', phase: 'Test' },
    ),
  )
  thunks.push(() =>
    agent(
      `Launch/reach the app (${input.app}) and evaluate usability as a first-time user per your agent instructions (navigation logic, task flows, progressive disclosure).\n${shared}`,
      { agentType: 'ux-tester', effort: 'high', schema: TESTER_SCHEMA, label: 'ux-tester', phase: 'Test' },
    ),
  )
}

const raw = await parallel(thunks)
const names = input.user_facing ? ['system', 'ui', 'ux'] : ['system']
const reports = names.map((name, i) => ({ tester: name, report: raw[i] || null }))

const missing = reports.filter((r) => !r.report).map((r) => r.tester)
const verdicts = reports.filter((r) => r.report).map((r) => r.report.verdict)
const overall = missing.length || verdicts.includes('FAIL') ? 'FAIL' : verdicts.includes('NEEDS-WORK') ? 'NEEDS-WORK' : 'PASS'
if (missing.length) log(`Tester(s) returned nothing: ${missing.join(', ')} — treating as FAIL`)
log(`Overall: ${overall}`)

return { overall, reports, missing_testers: missing }
