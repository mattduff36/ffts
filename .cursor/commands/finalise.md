# /finalise

This command authorizes local finalisation and commit, but not push.

1. Check for an active Agent Review or finalise terminal and wait if one is running.
2. For a protocol-managed CRITICAL workstream whose review is closed, run `npx tsx scripts/workflow-protocol.ts finalise-start --workstream <id>` once Workstream 2 finalise integration is available.
3. Run `npm run finalise`.
4. Never push from this command. Push requires the exact global authorization wording.
5. Resolve any printed pending monthly follow-up through the established approve/reject/skip flow.
6. Read the generated `docs_private/automation/runs/finalise/*.md` summary and report its local path.
