# /fixerrors

<!-- trusted-operational-action: {"commandId":"fixerrors","safetyContract":"fixerrors-exact-snapshot-v1","registry":"scripts/automation/trusted-operational-actions.ts"} -->

1. Run `npm run fixerrors` (or `npm run fixerrors -- --no-clear`). This is the non-destructive export/analysis phase. It creates a repeatable-read production snapshot over `POSTGRES_URL_NON_POOLING`, writes and read-verifies `docs_private/error-snapshot.json` plus analysis artifacts, and prints a cleanup command bound to snapshot ID, checksum, row count, target fingerprint, schema fingerprint (embedded in the snapshot), expiry, safety contract, and manifest.
2. If the snapshot is empty, do not run cleanup. Otherwise obtain explicit confirmation: production error logs have been exported; only the exact verified snapshot `error_logs` rows and their inventoried `error_log_alerts` will be cleared; SET NULL collateral on usage/health FKs may occur and is recorded; newer/unexported errors remain; the exported artifact is retained.
3. After confirmation, run the exact bound cleanup command printed by the export phase. Never reconstruct, loosen, or substitute its arguments. Any artifact, target, schema, identity, expiry, confirmation, or transaction mismatch suspends operational trust and stops cleanup.
4. Read `docs_private/error-analysis.md` and triage root-cause clusters independently. One CRITICAL database/RLS/auth/security cluster must not escalate unrelated FAST/STANDARD clusters.
5. Outcomes are durable on the snapshot: `rejected`, `rolled_back`, `committed`, `committed_unverified`, or `indeterminate`. Never automatically retry a destructive cleanup, especially after connection loss during `COMMIT` or `committed_unverified` / `indeterminate` states — verify the database manually first.
6. Changing this command's snapshot, validation, transaction, reference, or deletion implementation is itself CRITICAL and requires a new architecture gate.
7. Debug UI clear and `scripts/clear-all-error-logs.ts` remain untrusted separate surfaces (`R-DEBUG-CLEAR-UNTRUSTED`).
8. Commit a coherent local set when fixing clusters. Never push without separate authorization.
