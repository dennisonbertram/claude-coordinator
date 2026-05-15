# Agent Output Schemas

These JSON Schemas (Draft 2020-12) are the canonical contracts for each agent's structured output. Agents return JSON conforming to their schema; the coordinator validates the JSON before accepting it.

| Schema | Agent | Purpose |
|--------|-------|---------|
| `worker-output.schema.json` | `worker` | Strict TDD output with three-commit audit trail |
| `worker-refactor-output.schema.json` | `worker-refactor` | Behavior-preserving refactor with before/after evidence |
| `worker-test-output.schema.json` | `worker-test` | Test-coverage uplift with mutation-check evidence |
| `worker-investigation-output.schema.json` | `worker-investigation` | Read-only research findings |
| `reviewer-output.schema.json` | `reviewer` | Code review with severity-rated findings + external review |
| `intent-validator-output.schema.json` | `intent-validator` | Intent-vs-implementation gap analysis |
| `learning-extractor-output.schema.json` | `learning-extractor` | Structured learning candidates from outputs + transcripts |
| `briefer-output.schema.json` | `briefer` | Structured situational briefing |
| `planner-output.schema.json` | `planner` | Task breakdown with behavioral test specs |
| `ui-tester-output.schema.json` | `ui-tester` | Visual quality assessment |
| `ux-tester-output.schema.json` | `ux-tester` | Usability assessment |
| `system-tester-output.schema.json` | `system-tester` | Integration & coverage assessment |
| `scribe-output.schema.json` | `scribe` | File write confirmation |

## Validating output

Use `bin/coord-validate` to check a JSON file against its schema:

```bash
bin/coord-validate worker output.json
```

Under the hood this runs `ajv` (preferred) or a JSON Schema validator of your choice. The coordinator delegates this check to a scribe or worker during the `integrate` phase.

## Why schemas instead of Markdown templates

The earlier version of this project used Markdown templates with required `### Headings`. Models would drift on capitalization, section ordering, and prose vs. structured content — making "did the worker conform?" an interpretive judgment rather than a mechanical check. JSON Schema solves this:

- Validation is deterministic
- Schemas can be versioned
- The output goes straight into `.coord/tasks/TASK-XXX.json` with no Markdown-to-JSON translation step
- Telling a model "conform to this schema" elicits more reliable structure than "fill in this template"

## Adding a new schema

1. Drop a new `<agent>-output.schema.json` in this directory
2. Reference it from the agent's `.md` file in the Output Contract section
3. Add a row to the table above
4. The coordinator picks it up automatically — no install step needed
