# /fap

Short alias only. `fap` / `/fap` does **not** authorize pushing.

1. If the user did not also write an explicit push phrase (`finalise and push`, `finalise:push`, or `push to GitHub`), refuse to push and ask them to use one of those phrases.
2. When an explicit push phrase is present, follow the `finalise and push` flow (`npm run finalise:push`) after stating the branch and a short summary of what will be pushed.
3. Check for an active Agent Review or finalise terminal and wait if one is running.
4. For a protocol-managed CRITICAL workstream whose review is closed, run `npx tsx scripts/workflow-protocol.ts finalise-start --workstream <id>` before finalise so the active checkpoint context is bound.
5. If a deterministic allowlisted step fails (build / test:run / testsuite), fix the root cause, run `npm run finalise:repair` to re-run only that step, then run the original authorized finalise command once for closure. Do not use repair for migrations, db validate, commit, push, or unknown failures.
6. Resolve any printed pending monthly follow-up through the established approve/reject/skip flow.
7. Read the generated `docs_private/automation/runs/finalise/*.md` summary and report its local path.
