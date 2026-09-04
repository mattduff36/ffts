# /fap

`fap` / `/fap` implements the global operator contract:

`fap` = `finalise and push` = COMPLETE_AND_RELEASE(normal)

This alias is an authorized push phrase for the current explicit invocation only. Quoted, negated, historical, or file-mentioned occurrences do not authorize push.

Local commit is not release-ready, and release-ready is not a push. This alias authorizes complete-and-release, then push.

1. Before pushing, state the branch and a short summary of the commits and changed files that will be pushed.
2. Check for an active Agent Review or finalise terminal and wait if one is running.
3. Run `npm run workflow-protocol -- status --blocking` first. Do not hand-edit protocol JSON.
4. `fap` may run `npx tsx scripts/workflow-protocol.ts finalise-start --workstream <id>` only when exactly one active CRITICAL leaf is `review_closed`, no competing blocker exists, and the reviewed HEAD matches current HEAD. Otherwise stop with the full diagnostic.
5. Ordinary (non-CRITICAL) completion: run `npm run finalise` (no `--push`). Do not run `npm run finalise:push`. After finalise succeeds, fetch `origin`, confirm the release SHA fast-forwards `origin/main`, then `git push origin <full-sha>:refs/heads/main`. No force push.
6. Protected CRITICAL / C9 completion: when a captured C9 binding is required, run `npm run finalise:push` so the protected C9 push machinery is used. Do not weaken the ordinary `--push` refusal.
7. If a deterministic allowlisted step fails (build / test:run / testsuite), fix the root cause, run `npm run finalise:repair` to re-run only that step, then run the same ordinary or protected completion path once for closure. Do not use repair for migrations, db validate, commit, push, or unknown failures.
8. Never push after a failed build, test, cleanup, commit, or release-metadata step.
9. Resolve any printed pending monthly follow-up through the established approve/reject/skip flow.
10. Read the generated `docs_private/automation/runs/finalise/*.md` summary and report its local path.
