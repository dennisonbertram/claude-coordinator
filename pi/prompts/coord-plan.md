---
description: Produce a task breakdown via the planner agent (coordinator plan phase)
argument-hint: [extra context for the planner]
---
Enter the PLAN phase. Delegate planning by writing a precise planner brief (the confirmed intent from `docs/context/command-intent.md`, plus: $@) and run the **planner** agent on it — spawn it with the coordinator package's agent definition (or reason it yourself only if the planner agent is unavailable).

Requirements for the resulting plan: every task has a contract (task_id, type, scope, allowed_files, forbidden_files, behavioral_tests, regression_test_requirements); parallel batches are file-disjoint; refactors are typed `refactor`, not `feature`.

Write the plan to `docs/plans/active-plan.md`, present it to me concisely, and WAIT for my explicit approval before calling coord_implement.
