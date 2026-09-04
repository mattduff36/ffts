# Forest Farm Operational Scripts

This directory contains production bootstrap, database migration, verification, release, and maintenance tooling for FFTS.

## Main Commands

```bash
npm run forest:bootstrap-production
npm run db:baseline
npm run db:validate
npm run setup:storage
npm run fixerrors
npm run fixerrors -- --no-clear
npm run createinvoice -- --from YYYY-MM-DD --to YYYY-MM-DD
npm run finalise
```

See `README-SETUP-FFTS.md` and `docs/guides/HOW_TO_RUN_MIGRATIONS.md` before running database operations.

## Directory Structure

- `production/` — Forest Farm bootstrap entry points.
- `migrations/` — `pg`-based migration runners, schema inventory, and parity-state checks.
- `maintenance/` — explicit operational repair, backup, and storage tasks.
- `testing/` — non-production verification helpers.
- `automation/` — release/finalisation automation.

## Safety Rules

1. Load credentials only from `.env.local`; never print environment values.
2. Use `POSTGRES_URL_NON_POOLING` with the documented `pg.Client` pattern for migrations.
3. Inspect target SQL and take a schema inventory before a live migration.
4. Run `npm run db:validate` after schema changes.
5. Do not add demo seeds, customer exports, employee records, fleet records, or one-off client repair scripts.
6. Test helpers must use deterministic fictional fixtures and must not alter production data unless a runbook explicitly authorizes it.

### Scheduling sample-data exception

The approved Scheduling production sample fixture is `scripts/testing/scheduling-sample.ts`. It is limited to
fictional `example.test` data marked `scheduling-sample-v1`, requires the configured production project
reference, validates the timed scheduling schema, creates no resource assignments, and has a matching
ownership-checked cleanup command. Its guarded queue extension reuses that same owner and cleanup path,
adds unscheduled Quote workflow coverage only when the base fixture is still in its expected state,
and supports a denser current/next-week client-demo play pack (`99100-SD` range) on top of that owner.

Follow `docs/guides/SCHEDULING_SAMPLE_DATA_RUNBOOK.md`. Never run the apply or destructive cleanup
commands without the exact confirmation token and an operator review of the generated manifest.

### Fleet and Inventory sample-data exception

The approved removable Fleet and Inventory production sample fixture is
`scripts/testing/fleet-inventory-sample.ts`. It creates only deterministic fictional `ZZ99-` Plant
and Inventory records marked `fleet-inventory-sample-v1`, requires an exact production-project
allowlist, writes a reviewable manifest, preserves existing locations, creates no registrations or
tracker identifiers, and enforces zero active Fleet Plant / Inventory Minor Plant overlap.

Its cleanup command verifies exact ownership and aborts if any sample asset has acquired inspections,
maintenance history, scheduling assignments, movements, checks, groups, or other operational
dependencies. Follow `docs/guides/FLEET_INVENTORY_SAMPLE_DATA_RUNBOOK.md`. Never run apply or
destructive cleanup without the exact confirmation token and explicit operator approval.

## TEE V2.4 Workflow Enforcement

FFTS enforces Token-Efficient Engineering V2.2 inside the repository. The global TEE skill remains outside Git and has a separate manual rollback path.

```bash
npm run workflow-plan:validate -- <plan-path>
npm run workflow-protocol -- status --workstream <id>
npm run workflow-protocol -- status --blocking
npm run review:preflight -- --workstream <id> [--plan <path>]
npm run workflow-review
```

Long-running review preflight and fix-delta verification run independent read-only checks concurrently after the candidate is frozen. Set `TEE_VERIFY_JOBS=3` (default) or `TEE_VERIFY_JOBS=1` for serial fallback. Concurrency is scheduling only and is not review or finalise evidence. Progress prints to stderr as a hierarchical stage dashboard on a TTY; non-TTY and CI stay newline-safe without control codes. JSON manifests and protocol records stay machine-clean. Authority-changing steps (`preflight-record`, `fix-record`, `finalise-start`, finish, push) stay serial. The canonical workflow suite remains one process because its fixtures are not proven isolated for sharding. After that suite, preflight discovers any remaining required IDs in trusted `tests/` and `testsuite/` files and executes only those owning files. `tests/unit|integration|regression` use the integration Vitest project, `tests/ui` uses the UI project, and `testsuite/api` uses `testsuite/config/vitest.config.ts`. Playwright `testsuite/ui` ownership fails closed. Leftover files run serially unless isolation is explicitly proven. Source presence is not proof; the owning tests must run and pass on the same frozen candidate. Untrusted paths, missing owners, and ambiguous ID ownership fail closed.

Canonical private artifact roots (ignored, repository-local):

- `docs_private/automation/plans/`
- `docs_private/automation/workstreams/`
- `docs_private/automation/workflow-events/`
- `docs_private/automation/reviews/`
- `docs_private/automation/follow-ups/`

Native writers emit lane-based `plan-contract-marker:v2` and V4 completion markers. Readers remain compatible with V1-V3 evidence. Opaque workstream/checkpoint IDs are sanitized before filesystem use. External/sibling plan roots are rejected. The Cursor stop hook is fail-open with `loop_limit: 1`.

Cursor commands under `.cursor/commands/` cover `/workflow-review`, `/finalise`, `/finalise-full`, `/fap`, `/ffap`, `/createinvoice`, `/cleancodebase`, and `/fixerrors`. They are thin adapters to the global operator contract: `fap` = `finalise and push` = COMPLETE_AND_RELEASE(normal), and `ffap` = `finalise full and push` = COMPLETE_AND_RELEASE(full). `/finalise` and `/finalise-full` do not authorize a push. Short aliases `/fap` and `/ffap` are authorized push phrases. Ordinary `fap` runs `npm run finalise` then a normal fast-forward push; ordinary `ffap` runs `npm run finalise:full` then a normal fast-forward push. Protected CRITICAL / C9 releases still use `npm run finalise:push` / `npm run finalise:full:push`. The long phrases `finalise and push`, `finalise full and push`, `finalise:push`, and `push to GitHub` also authorize those complete-and-release paths. `/fixerrors` is a trusted operational command under safety contract `fixerrors-exact-snapshot-v1`: default `npm run fixerrors` exports a repeatable-read snapshot only; destructive cleanup requires the exact printed bound `--cleanup` command after confirmation.

Model registry version: `ffts-tee-model-registry-v1`.

## Automation Artifacts

`fixerrors` creates `docs_private/` when needed and writes ignored analysis, fix-log, snapshot (`error-snapshot.json` / `error-snapshots/`), and structured automation-run files. Default export and `--no-clear` never mutate production. Cleanup deletes only exact verified snapshot `error_logs` IDs plus inventoried `error_log_alerts`, records SET NULL collateral, and refuses automatic retry after `indeterminate` / `committed_unverified` outcomes. Debug UI clear and `scripts/clear-all-error-logs.ts` remain untrusted.

`finalise` preflights the three release artifacts before making a product commit:

- `lib/config/release-version.json`
- `lib/config/release-history.json`
- `docs_private/release-log.md`

The Markdown release log is the only tracked file under `docs_private/`. If release generation unexpectedly fails after the product commit, finalise blocks the push, preserves the local commit and generated files, and prints exact recovery commands. Authorised `--push` uses the C9-validated full SHA to `origin` `refs/heads/main` (`<sha>:refs/heads/main`). It does not use bare `git push`, mutable `HEAD`, or ambient upstream configuration. Ordinary (non-CRITICAL) persisting finalise does not require C9 identity; `--push` on that path is refused before mutation so bookkeeping cannot fail after a release commit. CRITICAL `finalise-start` bindings still require C9 for finish and push.

Exact finalise checkpointing reuses prior passed steps only when content/command/environment/artifact fingerprints match. Protocol-managed CRITICAL runs bind `activeFinaliseContext` after `workflow-protocol finalise-start`. Valid `split` ancestors are parked historical records. The active descendant owns remaining work; after two failed premium rounds that remainder is routing, isolation, or proven removal from release — not another normal final-diff pass. Orphan/malformed splits still block. Do not launch a third premium review for the same CRITICAL continuation. Routing or split does not reset this budget. `finalise-start` requires current `HEAD` to match the reviewed `headCommit`; drifted HEAD must refresh via `workflow-protocol review-start --pass delta`. Inspect blockers with `npm run workflow-protocol -- status --blocking`. Ordinary runs use `docs_private/automation/finalise-cache/`. The 45-minute mtime skip path remains an explicit compatibility fallback only (`allowLegacyMtimeFallback`).

`npm run finalise:repair` re-runs only a fresh allowlisted failed step (`build`, `test:run`, `testsuite`) from `docs_private/automation/finalise-last-failure.json`. Migrations, database validation, commit, push, stale, and unknown failures are refused. Successful repair writes `finalise-repair-complete.json` (awaiting closure) and blocks another repair until the original `npm run finalise` / `finalise:full` clears that gate. Open CRITICAL protocol workstreams that are not `finalise_ready` block mutating finalise; `--help` / `--dry-run` never apply finalise completion correlation.

Project rules under `.cursor/rules/` map finalise/fixerrors requests, require push-content reporting, and keep all workflows self-contained in FFTS.

## Invoice Evidence

Generate a local FFTS invoice evidence report with:

```bash
npm run createinvoice -- --from "YYYY-MM-DD" --to "YYYY-MM-DD" --rate "28" --support-rate "5" --include-unpushed "true"
```

The command reads local release history, Git commits, and parent Cursor chats. It does not contact
production services, alter application data, stage files, commit, or push. The default transcript
directory is `~/.cursor/projects/d-Websites-ffts/agent-transcripts`. Override it with
`CURSOR_AGENT_TRANSCRIPTS_DIR` or `--transcripts-dir`; the command-line option takes precedence.

Evidence is written to:

- `docs_private/invoices/invoice-<from>-to-<to>-evidence.json`
- `docs_private/invoices/invoice-<from>-to-<to>-evidence.md`

The agent saves the reconciled copy-ready result beside them as
`docs_private/invoices/invoice-<from>-to-<to>-final.md`. These private artifacts remain ignored by
Git. Use `--output-dir` only when a different local ignored destination is required.

If transcript discovery fails, verify the FFTS Cursor project directory or rerun with
`--transcripts-dir "<path>"`. Missing or incomplete release evidence should be corrected at its
FFTS source and the command rerun; do not copy release records, transcripts, credentials, or
generated auth state from another repository.
