# /ffap

`ffap` / `/ffap` is the short alias for `finalise full and push`. It authorizes `npm run finalise:full:push`.

Local commit is not release-ready, and release-ready is not a push. This alias is an authorized push phrase.

1. Before pushing, state the branch and a short summary of the commits and changed files that will be pushed.
2. Check for an active Agent Review or finalise terminal and wait if one is running.
3. Run `npm run workflow-protocol -- status --blocking` first. Do not hand-edit protocol JSON.
4. `ffap` may run `npx tsx scripts/workflow-protocol.ts finalise-start --workstream <id>` only when exactly one active CRITICAL leaf is `review_closed`, no competing blocker exists, and the reviewed HEAD matches current HEAD. If HEAD has drifted, run `review-start --pass delta` and a fresh final-diff review first. If the state is ambiguous, stop with the full diagnostic.
5. Then run `npm run finalise:full:push`.
6. If a deterministic allowlisted step fails (build / test:run / testsuite), fix the root cause, run `npm run finalise:repair` to re-run only that step, then run the original authorized `npm run finalise:full:push` once for closure. Do not use repair for migrations, db validate, commit, push, or unknown failures.
7. Never push after a failed build, test, cleanup, commit, or release-metadata step.
8. Resolve any printed pending monthly follow-up through the established approve/reject/skip flow.
9. Read the generated `docs_private/automation/runs/finalise/*.md` summary and report its local path.
