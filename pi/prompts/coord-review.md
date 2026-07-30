---
description: Multi-pass adversarial code review via the coord_review tool
argument-hint: [scope override, default: changes from this session's tasks]
---
Enter the REVIEW phase. Scope: ${1:-all changes produced by this session's completed tasks (describe files/commit range precisely from the task results)}.

Call the **coord_review** tool with that scope (plus useful context: what the changes were supposed to do, known risk areas). It runs coverage-first finders across correctness/security/concurrency/tests, consolidates by root cause, and adversarially verifies each cluster.

Then judge: CRITICAL/HIGH confirmed findings → back to coord_implement with fix contracts; MEDIUM → decide fix-now vs tracked; LOW/info → note for learnings. Report the verdict and your decision to me.
