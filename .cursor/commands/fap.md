# /fap

Short alias only. `fap` / `/fap` does **not** authorize pushing.

Local commit is not release-ready, and release-ready is not a push.

1. If the user did not also write an explicit push phrase (`finalise and push`, `finalise:push`, or `push to GitHub`), refuse to push and ask them to use one of those phrases.
2. When an explicit push phrase is present, follow the `finalise and push` flow (`npm run finalise:push`) after stating the branch and a short summary of what will be pushed.
3. Check for an active Agent Review or finalise terminal and wait if one is running.
4. Run `npm run workflow-protocol -- status --blocking` first. Do not hand-edit protocol JSON.
5. `fap` may run `npx tsx scripts/workflow-protocol.ts finalise-start --workstream <id>` only when exactly one active CRITICAL leaf is `review_closed`, no competing blocker exists, and the reviewed HEAD matches current HEAD. Otherwise stop with the full diagnostic.
6. Then run `npm run finalise`. Never push from this alias.
7. If a deterministic allowlisted step fails (build / test:run / testsuite), fix the root cause, run `npm run finalise:repair` to re-run only that step, then run the original authorized finalise command once for closure. Do not use repair for migrations, db validate, commit, push, or unknown failures.
8. Resolve any printed pending monthly follow-up through the established approve/reject/skip flow.
9. Read the generated `docs_private/automation/runs/finalise/*.md` summary and report its local path.
