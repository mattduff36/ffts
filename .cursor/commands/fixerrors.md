# /fixerrors

<!-- trusted-operational-action: {"commandId":"fixerrors","safetyContract":"fixerrors-exact-snapshot-v4","registry":"scripts/automation/trusted-operational-actions.ts"} -->

1. Run `npm run fixerrors`. This exports a repeatable-read snapshot of **active** production error logs, writes and reads back the recovery artifact and analysis report, then archives those exact snapshot rows in the same process. After a successful archive or empty-snapshot no-op, it purges **archived** rows whose `archived_at` is older than 12 months. No confirmation step. Do not reconstruct a separate cleanup command. `--no-clear` is rejected before any database connection.
2. If the snapshot is empty, no archive write is required. Newer or already-archived rows stay untouched until they age past the 12-month retention window. The exported artifact is retained. Stop here: no analysis Task, no reviewer.
3. Archive mutates only `error_logs.status` and `error_logs.archived_at` for the exact verified snapshot IDs. Retention deletes only expired archived rows in a separate transaction. `error_log_alerts` change only via verified CASCADE. Any artifact, target, schema, identity, expiry, mixed-state, or transaction mismatch suspends operational trust and stops that write.
4. After a non-empty snapshot, launch **exactly one** `Task` for premium analysis:
   - `subagent_type: "generalPurpose"`
   - `model: "gpt-5.6-sol-high"`
   - `run_in_background: false`
   - Do **not** use `architecture-gate` for analysis. That gate stays reserved for later CRITICAL implementation.
   - Read-only except writing `docs_private/error-analysis-decision.md`.
   - Inputs: `docs_private/error-analysis.md`, `docs_private/error-snapshot.json`, and only the source files those artifacts name.
   - Independently verify each mechanical cluster’s TEE lane/action. One CRITICAL cluster must not escalate unrelated FAST/STANDARD clusters.
   - External, network, third-party, and user-input patterns remain report-only when no code defect is evidenced.
   - Write a binding decision file with this shape:
     - `snapshotId` copied from the sealed snapshot
     - analyst: `generalPurpose` / `gpt-5.6-sol-high`
     - one section per cluster: independently verified lane, action (`fix` | `report-only` | `manual-investigation`), evidence paths, files, required test IDs, do-not-do, and report-only rationale when applicable
   - No application fixes, no commits, no production SQL.
5. Parent Cursor Grok reads `docs_private/error-analysis-decision.md` and implements only `fix` clusters. Do not invent clusters and do not re-open a second deep analysis unless that decision file is missing, malformed, or contradicted by the snapshot. If the decision file is missing after the analysis Task, stop and report.
6. Process clusters separately from the decision. After the decision, apply the current TEE execution-mode advisory only when multiple substantial `fix` clusters are genuinely independent.
7. CRITICAL clusters in the decision still require the normal architecture-gate and the database rule where relevant **before that cluster is implemented**. Changing this command's snapshot, validation, transaction, archive, retention, or safety-contract implementation is itself CRITICAL.
8. After all `fix` clusters, run the named targeted checks from the decision and report fixed/report-only/manual-investigation outcomes.
9. If any application or test file changed, do not commit yet. Launch **exactly one** `final-diff-reviewer` with `run_in_background: false`, `Diff: uncommitted changes`, and custom instructions limited to the fixerrors decision plus the changed files.
10. If that reviewer returns blockers: one consolidated blocker-family fix, then one closure/delta `final-diff-reviewer`. After two failed premium reviews, stop and report instead of reviewing again.
11. Skip the reviewer when every cluster is report-only or manual-investigation and no code changed.
12. When a `final-diff-reviewer` actually ran, emit `reviewEscalationReasons: ["fixerrors-command-mandated"]` and `independentReviewRequired: true` on the parent completion marker.
13. Commit a coherent local set. Resolve any printed monthly follow-up through the established flow. Never push without separate authorization.
14. Crash recovery only: if analysis sealed but archive did not finish, `npm run fixerrors -- --cleanup` with the exact bound snapshot identity may be used. That path archives, then may purge expired archived rows. It must never delete active or recently archived rows. Old v1/v2/v3 delete or archive commands fail closed before any database connection.
