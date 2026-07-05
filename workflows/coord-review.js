export const meta = {
  name: 'coord-review',
  description: 'Multi-dimension code review: parallel coverage-first finders, dedupe, adversarial verification, overall verdict',
  whenToUse: 'Coordinator review phase, after integrating a wave of changes that meets any review trigger',
  phases: [
    { title: 'Find', detail: 'parallel finders per review dimension, coverage-first' },
    { title: 'Verify', detail: 'adversarial verification of each deduped finding' },
  ],
}

// args: {
//   scope: string       — what changed: files, commit range, task summaries
//   context: string     — optional extra context (behavioral specs, known risks)
//   repo_root: string   — absolute path of the project
//   external: boolean   — run the external second-opinion pass (default true)
// }

// Callers sometimes deliver args as a JSON-encoded string — parse defensively.
const input = typeof args === 'string' ? JSON.parse(args) : args
if (!input || !input.scope || !input.repo_root) {
  throw new Error('coord-review requires args.scope and args.repo_root')
}

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        // additionalProperties intentionally permitted: strict item schemas caused
        // StructuredOutput retry-cap failures on finders (observed in harness run 2).
        additionalProperties: true,
        required: ['title', 'severity', 'file', 'description'],
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          file: { type: 'string' },
          line: { type: 'integer' },
          description: { type: 'string' },
          evidence: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_real', 'confirmed_severity', 'reasoning'],
  properties: {
    is_real: { type: 'boolean' },
    confirmed_severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
    reasoning: { type: 'string' },
  },
}

// Coverage-first finder instruction (post-4.7 models follow severity filters literally,
// which depresses recall — so finders report EVERYTHING and the verify stage filters).
const COVERAGE = [
  'Report every issue you find, including ones you are uncertain about or consider low-severity.',
  'Do not filter for importance or confidence — a separate adversarial verification step does that.',
  'Your goal is coverage: better to surface a finding that later gets dismissed than to silently drop a real bug.',
  'Include a confidence level and severity estimate on each finding.',
].join(' ')

const DIMENSIONS = [
  { key: 'correctness', focus: 'logic errors, edge cases, off-by-ones, error propagation, broken invariants, intent-vs-implementation mismatches' },
  { key: 'security', focus: 'injection, authn/authz gaps, secrets handling, unsafe input validation, path traversal, unsafe deserialization' },
  { key: 'concurrency', focus: 'race conditions, shared mutable state, missing locks/transactions, async ordering hazards, idempotency' },
  { key: 'tests', focus: 'missing or weak tests, assertions that cannot fail, untested branches introduced by this change, brittle implementation-coupled tests' },
]

phase('Find')
const finderThunks = DIMENSIONS.map((d) => () =>
  agent(
    [
      `Review the following change set in the repo at ${input.repo_root}, focusing ONLY on ${d.key}: ${d.focus}.`,
      `Change set: ${input.scope}`,
      input.context ? `Context: ${input.context}` : '',
      COVERAGE,
      `Read the actual files/diffs — do not review from the description alone.`,
    ].filter(Boolean).join('\n'),
    { agentType: 'reviewer', model: 'sonnet', effort: 'high', schema: FINDINGS_SCHEMA, label: `find:${d.key}`, phase: 'Find' },
  ),
)
if (input.external !== false) {
  finderThunks.push(() =>
    agent(
      [
        `Run your EXTERNAL second-opinion review pass (the \`llm\` CLI flow from your agent instructions) over this change set in ${input.repo_root}:`,
        `Change set: ${input.scope}`,
        `Translate the external model's findings into the findings format, marking each with evidence "external second opinion".`,
        `Evaluate them first — drop anything you can already show is a false positive, and say so.`,
        `If the llm CLI is not installed or errors, return an empty findings array (do not fabricate findings).`,
      ].join('\n'),
      { agentType: 'reviewer', model: 'sonnet', effort: 'high', schema: FINDINGS_SCHEMA, label: 'find:external', phase: 'Find' },
    ),
  )
}

// Barrier is intentional: dedupe needs the full finding set before expensive verification.
const found = (await parallel(finderThunks)).filter(Boolean).flatMap((r) => r.findings)
const seen = new Set()
const deduped = found.filter((f) => {
  // Normalize the file key: strip repo prefix and :line suffixes so path-format
  // variance between finders doesn't defeat the dedupe.
  const fileKey = String(f.file || '').replace(input.repo_root, '').replace(/^\/+/, '').split(':')[0]
  const key = `${fileKey}::${(f.title || '').toLowerCase().slice(0, 48)}`
  if (seen.has(key)) return false
  seen.add(key)
  return true
})
log(`${found.length} raw finding(s), ${deduped.length} after mechanical dedupe`)

phase('Verify')

// Semantic consolidation: finder dimensions rediscover the same defect under
// different titles, and each duplicate would otherwise buy a full adversarial
// verification. One cheap pass clusters findings by root cause first.
const CLUSTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['clusters'],
  properties: {
    clusters: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'severity', 'file', 'description', 'member_indices'],
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
          file: { type: 'string' },
          description: { type: 'string' },
          member_indices: { type: 'array', items: { type: 'integer' } },
        },
      },
    },
  },
}

let clusters = deduped.map((f) => ({ title: f.title, severity: f.severity, file: f.file, description: f.description, evidence: f.evidence, members: [f] }))
if (deduped.length > 3) {
  const consolidated = await agent(
    [
      `Cluster these code-review findings by ROOT CAUSE. Findings that describe the same underlying defect`,
      `(even under different titles, files-with-line-suffixes, or phrasings, e.g. "X lacks validation" vs "no tests for X's validation") belong in ONE cluster.`,
      `Genuinely distinct defects stay separate — do not over-merge. Every input index must appear in exactly one cluster.`,
      `For each cluster: a title naming the root cause, the HIGHEST severity among members, the primary file, a description that covers all members, and member_indices (0-based indices into the input array).`,
      `Findings (JSON array):`,
      JSON.stringify(deduped, null, 1),
    ].join('\n'),
    { agentType: 'reviewer', model: 'sonnet', effort: 'medium', schema: CLUSTER_SCHEMA, label: 'consolidate', phase: 'Verify' },
  )
  if (consolidated && Array.isArray(consolidated.clusters) && consolidated.clusters.length > 0) {
    const assigned = new Set()
    clusters = consolidated.clusters.map((c) => ({
      title: c.title,
      severity: c.severity,
      file: c.file,
      description: c.description,
      members: (c.member_indices || []).filter((i) => !assigned.has(i) && assigned.add(i)).map((i) => deduped[i]).filter(Boolean),
    })).filter((c) => c.members.length > 0)
    // Any finding the consolidator dropped still gets verified on its own.
    deduped.forEach((f, i) => {
      if (!assigned.has(i)) clusters.push({ title: f.title, severity: f.severity, file: f.file, description: f.description, members: [f] })
    })
  }
}
log(`${deduped.length} finding(s) consolidated into ${clusters.length} root cause(s)`)

// Tiered adversarial verification: full Opus xhigh only where the stakes are.
const VERIFY_TIER = {
  critical: { effort: 'xhigh' },              // reviewer default model (opus)
  high:     { effort: 'xhigh' },
  medium:   { effort: 'high' },
  low:      { model: 'sonnet', effort: 'high' },
  info:     { model: 'sonnet', effort: 'high' },
}

const verified = await parallel(
  clusters.map((c) => () => {
    const tier = VERIFY_TIER[c.severity] || VERIFY_TIER.medium
    const opts = { agentType: 'reviewer', effort: tier.effort, schema: VERDICT_SCHEMA, label: `verify:${c.title.slice(0, 40)}`, phase: 'Verify' }
    if (tier.model) opts.model = tier.model
    return agent(
      [
        `Adversarially verify this code-review finding (a root-cause cluster of ${c.members.length} raw finding(s)) in the repo at ${input.repo_root}. Your default stance is skepticism: try to REFUTE it.`,
        JSON.stringify({ title: c.title, severity: c.severity, file: c.file, description: c.description, raw_findings: c.members }, null, 1),
        `Read the actual code. Confirm it only if you can point at concrete evidence of a real defect a user or maintainer would hit.`,
        `If real, also confirm or correct the severity.`,
      ].join('\n'),
      opts,
    ).then((v) => ({ ...c, verdict: v }))
  }),
)

const confirmed = verified
  .filter(Boolean)
  .filter((f) => f.verdict && f.verdict.is_real)
  .map((f) => ({ ...f, severity: f.verdict.confirmed_severity }))

const ORDER = ['critical', 'high', 'medium', 'low', 'info']
confirmed.sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity))
const worst = confirmed.length ? confirmed[0].severity : null
const verdict = worst === 'critical' ? 'CRITICAL' : worst === 'high' ? 'HIGH' : worst === 'medium' ? 'MEDIUM' : worst ? 'LOW' : 'PASS'
log(`Verdict: ${verdict} — ${confirmed.length} confirmed finding(s)`)

return {
  verdict,
  approved: verdict === 'PASS' || verdict === 'LOW' ? 'YES' : verdict === 'MEDIUM' ? 'CONDITIONAL' : 'NO',
  confirmed_findings: confirmed.map((f) => ({
    title: f.title,
    severity: f.severity,
    file: f.file,
    description: f.description,
    reasoning: f.verdict.reasoning,
    consolidated_from: f.members.map((m) => m.title),
  })),
  dismissed_count: verified.filter(Boolean).length - confirmed.length,
  counts: { raw: found.length, deduped: deduped.length, root_causes: clusters.length },
}
