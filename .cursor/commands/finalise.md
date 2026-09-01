# /finalise

This command authorizes local finalisation and commit, but not push.

Local commit is not release-ready, and release-ready is not a push.

1. Check for an active Agent Review or finalise terminal and wait if one is running.
2. Run `npm run workflow-protocol -- status --blocking` first. Do not hand-edit protocol JSON.
3. Run `npx tsx scripts/workflow-protocol.ts finalise-start --workstream <id>` only for the unique active CRITICAL leaf that is `review_closed` with reviewed HEAD matching current HEAD. If HEAD has drifted, refresh via `review-start --pass delta` before finalise-start.
4. Run `npm run finalise`.
5. If a deterministic allowlisted step fails (build / test:run / testsuite), fix the root cause, run `npm run finalise:repair` to re-run only that step, then run the original `npm run finalise` once for closure. Do not use repair for migrations, db validate, commit, push, or unknown failures.
6. Never push from this command. Push requires the exact global authorization wording.
7. Resolve any printed pending monthly follow-up through the established approve/reject/skip flow.
8. Read the generated `docs_private/automation/runs/finalise/*.md` summary and report its local path.
