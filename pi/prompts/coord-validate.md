---
description: Validate completed work against the original intent, then close the session
---
Enter the VALIDATE phase — the last gate before close, and it is not optional.

Re-read `docs/context/command-intent.md` and the actual implementation (files changed per `.coord/task-ledger.json` and `.coord/tasks/*.json`). Compare what was BUILT against what I actually WANTED: scope gaps, interpretation drift, assumption mismatches, missing success criteria. Workers verifying their own scope is not this check.

Ask me clarifying questions directly if intent is ambiguous. Verdicts:
- SATISFIED → update `.coord/task-ledger.json`, write `.coord/context-packet.md` (milestone, decisions, blockers) for the next session, and give me a ≤10-bullet summary.
- NEEDS-WORK → list the specific gaps and propose fix contracts for coord_implement.
- NEEDS-DISCUSSION → raise the ambiguity with me, update the intent doc after we resolve it, then re-evaluate.

Rationalizations to reject: "the workers verified it", "small change, skip it", "the user seems satisfied".
