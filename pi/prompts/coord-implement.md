---
description: Execute the approved plan via the coord_implement tool (delegate + integrate phases)
argument-hint: [task ids to run, default: next ready batch]
---
Enter the DELEGATE phase for the approved plan in `docs/plans/active-plan.md` (batch: ${1:-next ready batch}).

1. Confirm the batch's tasks are file-disjoint; queue, merge, or re-scope anything that overlaps.
2. Call the **coord_implement** tool with the full task contracts. It handles worktree isolation, the JSON result contracts, the TDD-evidence gate with one retry, serial merge-back, and `.coord/` recording.
3. INTEGRATE: judge the results it returns — for each failed/blocked/unmerged task decide re-plan, re-scope, or retry (consider a stronger model for reasoning-hard failures). Do the semantic check the gate can't: do the behavioral tests actually cover the contract? Are regression tests meaningful?
4. Report per-task status to me before moving to review.
