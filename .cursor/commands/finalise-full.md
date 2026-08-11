# /finalise-full

This command authorizes local full finalisation and commit, but not push.

1. Check for an active Agent Review or finalise terminal and wait if one is running.
2. For a protocol-managed CRITICAL workstream whose review is closed, run `npx tsx scripts/workflow-protocol.ts finalise-start --workstream <id>` before finalise so the active checkpoint context is bound.
3. Run `npm run finalise:full`.
4. If a deterministic allowlisted step fails (build / test:run / testsuite), fix the root cause, run `npm run finalise:repair` to re-run only that step, then run the original `npm run finalise:full` once for closure. Do not use repair for migrations, db validate, commit, push, or unknown failures.
5. Never push from this command. Push requires the exact global authorization wording.
6. Resolve any printed pending monthly follow-up through the established approve/reject/skip flow.
7. Read the generated `docs_private/automation/runs/finalise/*.md` summary and report its local path.
