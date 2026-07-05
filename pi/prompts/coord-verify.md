---
description: Validate the built product via the coord_verify tool (test phase)
argument-hint: [app launch command or URL if user-facing]
---
Enter the TEST phase. Call the **coord_verify** tool: always system-level (full suites + behavioral-spec cross-reference from `docs/plans/active-plan.md`); pass `user_facing: true` with app "${1:-}" only if this session's changes touch user-facing surfaces.

Judge the result: FAIL → back to coord_implement with fix contracts from the testers' issues; NEEDS-WORK → decide fix-now vs next-session (critical/major issues should not ship); PASS → proceed to validation. Report to me.
