# Behavioral Test Specification

## Milestone
<!-- Which milestone this spec covers -->

## Behaviors

Each behavior is a testable assertion from the user's or system's perspective. Implementation details are not behaviors.

| ID | Behavior | Condition | Expected Outcome | Task | Status |
|----|----------|-----------|-----------------|------|--------|
| BT-001 | | When... | Then... | TASK-XXX | pending |

## Regression Coverage

Every task must have at least one regression test. This table tracks coverage.

| Task | Regression Test | What It Catches |
|------|----------------|----------------|
| TASK-XXX | | "If [X] breaks, this fails because [Y]" |

## Test Quality Checklist

- [ ] Every behavioral test describes observable outcomes, not implementation details
- [ ] Every test can meaningfully fail (no `expect(true).toBe(true)`)
- [ ] Every task type (feature, bugfix, refactor) has regression tests
- [ ] No test duplicates another test's assertion
- [ ] Mocks are minimal — test real behavior where possible
