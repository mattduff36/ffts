# /fixerrors

<!-- trusted-operational-action: {"commandId":"fixerrors","safetyContract":"fixerrors-exact-snapshot-v4","registry":"scripts/automation/trusted-operational-actions.ts"} -->

1. Run `npm run fixerrors`. This exports a repeatable-read snapshot of **active** production error logs, writes and reads back the recovery artifact and analysis report, then archives those exact snapshot rows in the same process. After a successful archive or empty-snapshot no-op, it purges **archived** rows whose `archived_at` is older than 12 months. No confirmation step. Do not reconstruct a separate cleanup command. `--no-clear` is rejected before any database connection.
2. If the snapshot is empty, no archive write is required. Newer or already-archived rows stay untouched until they age past the 12-month retention window. The exported artifact is retained. Stop here: no analysis Task, no reviewer.
3. Archive mutates only `error_logs.status` and `error_logs.archived_at` for the exact verified snapshot IDs. Retention deletes only expired archived rows in a separate transaction. `error_log_alerts` change only via verified CASCADE. Any artifact, target, schema, identity, expiry, mixed-state, or transaction mismatch suspends operational trust and stops that write.
4. After a non-empty snapshot, the capable premium parent or its assigned premium worker performs the analysis; no separate analysis Task is required.
   - The root parent owns delegation and review selection. Workers and reviewers must not launch other agents.
   - Assigned workers return the candidate and evidence; operational mutations, commits and release actions remain with the authorized root parent.
   - Do **not** use `architecture-gate` for routine analysis. Use independent review only when material risk, unresolved uncertainty, an explicit owner request, or an applicable repository gate warrants it.
   - Read-only except writing `docs_private/error-analysis-decision.md`.
   - Inputs: `docs_private/error-analysis.md`, `docs_private/error-snapshot.json`, and only the source files those artifacts name.
   - Independently verify each mechanical cluster’s TEE lane/action. One CRITICAL cluster must not escalate unrelated FAST/STANDARD clusters.
   - External, network, third-party, and user-input patterns remain report-only when no code defect is evidenced.
   - Write a binding decision file with this shape:
     - `snapshotId` copied from the sealed snapshot
     - analyst: actual parent or assigned worker identity and verified model; never claim another analyst ran
     - one section per cluster: independently verified lane, action (`fix` | `report-only` | `manual-investigation`), evidence paths, files, required test IDs, do-not-do, and report-only rationale when applicable
   - No application fixes, no commits, no production SQL.
5. The premium parent or assigned worker reads `docs_private/error-analysis-decision.md` and implements only `fix` clusters. Do not invent clusters and do not re-open a second deep analysis unless that decision file is missing, malformed, or contradicted by the snapshot. If the decision file is missing after analysis, stop and report.
6. Process clusters separately from the decision. After the decision, apply the current TEE execution-mode advisory only when multiple substantial `fix` clusters are genuinely independent.
7. For CRITICAL clusters, preserve applicable owner approval, database rules and mechanical gates **before that cluster is implemented**. The root selects architecture review when the risk or an applicable repository gate requires it; a worker never launches its own reviewer. Changing this command's snapshot, validation, transaction, archive, retention, or safety-contract implementation is itself CRITICAL.
8. After all `fix` clusters, run the named targeted checks from the decision and report fixed/report-only/manual-investigation outcomes.
9. After code changes, the root parent assesses the actual diff and verification evidence. Routine bounded repairs with sufficient evidence need no second model review. Select `final-diff-reviewer` only for material risk, unresolved uncertainty, an explicit owner request, or an applicable repository gate; record the concrete reason. The root invokes the read-only reviewer directly with `Diff: uncommitted changes`, the decision and changed files. Worker execution itself never requires another reviewer.
10. If that reviewer returns blockers: one consolidated blocker-family fix, then one closure/delta `final-diff-reviewer`. After two failed premium reviews, stop and report instead of reviewing again.
11. Skip code review and product commit when no code changed. Review does not replace targeted verification. When review is selected, its result and tests must match the actual candidate; changed code invalidates stale evidence. Unresolved review blockers still prevent commit.
12. Only when independent review was selected and a `final-diff-reviewer` actually ran, retain the legacy compatibility marker `reviewEscalationReasons: ["fixerrors-command-mandated"]` with `independentReviewRequired: true`, and report the concrete selection reason and candidate-bound result. Otherwise do not emit that reason or claim independent review occurred. Never fabricate review approval or bypass a mechanical release gate.
13. Commit a coherent local set. Resolve any printed monthly follow-up through the established flow. Never push without separate authorization.
14. Crash recovery only: if analysis sealed but archive did not finish, `npm run fixerrors -- --cleanup` with the exact bound snapshot identity may be used. That path archives, then may purge expired archived rows. It must never delete active or recently archived rows. Old v1/v2/v3 delete or archive commands fail closed before any database connection.
