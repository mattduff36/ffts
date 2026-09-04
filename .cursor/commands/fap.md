# /fap

`fap` / `/fap` implements the global operator contract:

`fap` = `finalise and push` = COMPLETE_AND_RELEASE(normal)

This alias is an authorized push phrase for the current explicit invocation only. Quoted, negated, historical, or file-mentioned occurrences do not authorize push.

Local commit is not release-ready, and release-ready is not a push. This alias authorizes `npm run finalise:push`.

1. Before pushing, state the branch and a short summary of the commits and changed files that will be pushed.
2. Check for an active Agent Review or finalise terminal and wait if one is running.
3. Run `npm run workflow-protocol -- status --blocking` first. Do not hand-edit protocol JSON.
4. `fap` may run `npx tsx scripts/workflow-protocol.ts finalise-start --workstream <id>` only when exactly one active CRITICAL leaf is `review_closed`, no competing blocker exists, and the reviewed HEAD matches current HEAD. Otherwise stop with the full diagnostic.
5. Then run `npm run finalise:push`.
6. If a deterministic allowlisted step fails (build / test:run / testsuite), fix the root cause, run `npm run finalise:repair` to re-run only that step, then run the original authorized `npm run finalise:push` once for closure. Do not use repair for migrations, db validate, commit, push, or unknown failures.
7. Never push after a failed build, test, cleanup, commit, or release-metadata step.
8. Resolve any printed pending monthly follow-up through the established approve/reject/skip flow.
9. Read the generated `docs_private/automation/runs/finalise/*.md` summary and report its local path.
