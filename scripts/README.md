# Forest Farm Operational Scripts

This directory contains production bootstrap, database migration, verification, release, and maintenance tooling for FFTS.

## Main Commands

```bash
npm run forest:bootstrap-production
npm run db:baseline
npm run db:validate
npm run setup:storage
npm run fixerrors
npm run createinvoice -- --from YYYY-MM-DD --to YYYY-MM-DD
npm run finalise
```

See `README-SETUP-FFTS.md` and `docs/guides/HOW_TO_RUN_MIGRATIONS.md` before running database operations.

## Directory Structure

### Revert the green preview theme

Run `npm run theme:revert` from a clean checkout on `codex/meeting-2026-10-28-preview` to restore the previous blue/yellow appearance, including tables, loaders and badges. This stages only the reviewed theme reversal; it preserves the meeting features, complete leaf logo pack, two-row scheduling layout, release history and database. It never pushes or deploys automatically.

Then run `npm run finalise`, review the result, and publish to the same preview with `git push origin HEAD:refs/heads/codex/meeting-2026-10-28-preview`. Do not use `finalise:push`, which targets production.

`npm run theme:revert -- --check` verifies applicability without changing files. The patch reverses only the green-theme changes, including the neutral-surface refinement, against the pre-theme baseline `5afb1534`. If later edits overlap, Git fails before applying; resolve the specific conflict rather than replacing entire files. There are no credentials, database operations or generated reports.

To undo a just-staged rollback before committing it, use `git apply --reverse --index scripts/theme/legacy-theme.patch`. After committing a rollback, revert that rollback commit to return to green. The helper refuses other branches and a dirty checkout.

- `production/` — Forest Farm bootstrap entry points.
- `migrations/` — `pg`-based migration runners, schema inventory, and parity-state checks.
- `maintenance/` — explicit operational repair, backup, and storage tasks.
- `testing/` — non-production verification helpers.
- `automation/` — release/finalisation automation.

## Safety Rules

1. Never print environment values. Development fixture/test automation loads only ignored `.env.development.local`; preserve hosted credentials privately in ignored `.env.ffts-hosted.local`, never as a test fallback. See `docs/guides/LOCAL_DEVELOPMENT.md`.
2. Use `POSTGRES_URL_NON_POOLING` with the documented `pg.Client` pattern for migrations.
3. Inspect target SQL and take a schema inventory before a live migration.
4. Run `npm run db:validate` after schema changes.
5. Do not add demo seeds, customer exports, employee records, fleet records, or one-off client repair scripts.
6. Test helpers must use deterministic fictional fixtures and must not alter production data unless a runbook explicitly authorizes it.
7. The hosted/client target is protected after sample cleanup, even while pre-launch. Retained test identities do not make it disposable. Fixtures and automated tests are development-only; use proportionate data/security gates. See `docs/guides/SAMPLE_DATA_PHASE.md`.

### Development-only sample fixtures and test users

`scripts/testing/scheduling-sample.ts` and `scripts/testing/fleet-inventory-sample.ts` require `FFTS_DATA_ENVIRONMENT=development` and exact verified API/PG/app targets even for read-only plans. Hosted tools report unavailable; legacy production-project allowlists cannot override this. CLI entrypoints load only `.env.development.local`; importing pure fixture builders loads no environment files.

Use `--confirm-development=FFTS_SCHEDULING_SAMPLE` or `--confirm-development=FFTS_FLEET_INVENTORY_SAMPLE` for apply/destructive cleanup. `scripts/setup-test-users.ts` requires `--confirm-development=FFTS_TESTSUITE` before creating any admin client. Legacy production confirmation commands are rejected. See `docs/guides/LOCAL_DEVELOPMENT.md` for NAS/tunnel configuration and readiness limits.

Scheduling retains fictional owned `example.test` records, unassigned work, guarded base/queue/play variants and ownership-checked cleanup. Fleet/Inventory retains deterministic `ZZ99-` records, existing locations, zero active overlap and no tracker identifiers/registrations. Cleanup still aborts on drift, ownership conflicts and operational dependencies. Debug PIN, signed previews and exact confirmation checks remain in force. Generated manifests stay under ignored `docs_private/automation/runs/`; test-user credentials remain only in ignored `testsuite/.state/test-users.json`. Never broadly delete residue or touch the four retained hosted test identities.

Historical production examples in the sample runbooks are superseded by the development-only guard; neither those examples nor a production confirmation grant hosted access.

## TEE V2.5 workflow with legacy protocol compatibility

The global TEE V2.5 skill controls workflow preference and topology. FFTS retains the V2.4 protocol runtime for TEE-FULL workstreams and historical audit records. Work in the current checkout and branch by default; a branch or worktree change is optional and needs explicit owner approval. The global skill remains outside Git.

```bash
npm run workflow-plan:validate -- <plan-path>
npm run workflow-protocol -- status --workstream <id>
npm run workflow-protocol -- status --blocking
npm run workflow-protocol -- successor --workstream <exhausted-id> --new-workstream <id> --plan <path> --owner-authorised-generation
npm run review:preflight -- --workstream <id> [--plan <path>]
npm run workflow-review
```

Owner-authorised `successor` is the V2.5 TEE-FULL path after two failed premium reviews. It parks the exhausted parent as `successor_parked` and creates one next-generation child on the same branch and HEAD with a fresh first/closure budget and inherited open blockers. A later exhausted generation may get another successor only with fresh explicit owner authorization. Owner-directed DIRECT/TEE-LIGHT continuation may instead address substantive blockers without claiming the old review passed. Ordinary `init`, `split`, plan edits, and new IDs cannot mint a review budget. Do not hand-edit protocol JSON.

Long-running review preflight and fix-delta verification run independent read-only checks concurrently after the candidate is frozen. Set `TEE_VERIFY_JOBS=3` (default) or `TEE_VERIFY_JOBS=1` for serial fallback. Concurrency is scheduling only and is not review or finalise evidence. Progress prints to stderr as a hierarchical stage dashboard on a TTY or Cursor interactive host; non-TTY and CI stay newline-safe without control codes. `npx tsx scripts/automation/tee-live-progress-demo.ts` is the short visual diagnostic for that live board. JSON manifests and protocol records stay machine-clean. Authority-changing steps (`preflight-record`, `fix-record`, `finalise-start`, finish, push) stay serial. The canonical workflow suite remains one process because its fixtures are not proven isolated for sharding. After that suite, preflight discovers any remaining required IDs in trusted `tests/` and `testsuite/` files and executes only those owning files. `tests/unit|integration|regression` use the integration Vitest project, `tests/ui` uses the UI project, and `testsuite/api` uses `testsuite/config/vitest.config.ts`. Playwright `testsuite/ui` ownership fails closed. Leftover files run serially unless isolation is explicitly proven. Source presence is not proof; the owning tests must run and pass on the same frozen candidate. Untrusted paths, missing owners, and ambiguous ID ownership fail closed.

Canonical private artifact roots (ignored, repository-local):

- `docs_private/automation/plans/`
- `docs_private/automation/workstreams/`
- `docs_private/automation/workflow-events/`
- `docs_private/automation/reviews/`
- `docs_private/automation/follow-ups/`

Native writers emit lane-based `plan-contract-marker:v2` and V4 completion markers. Readers remain compatible with V1-V3 evidence. Opaque workstream/checkpoint IDs are sanitized before filesystem use. External/sibling plan roots are rejected. The Cursor stop hook is fail-open with `loop_limit: 1`.

Cursor commands under `.cursor/commands/` cover `/workflow-review`, `/finalise`, `/finalise-full`, `/fap`, `/ffap`, `/createinvoice`, `/cleancodebase`, and `/fixerrors`. They are thin adapters to the global operator contract: `fap` = `finalise and push` = COMPLETE_AND_RELEASE(normal), and `ffap` = `finalise full and push` = COMPLETE_AND_RELEASE(full). `/finalise` and `/finalise-full` do not authorize a push. Short aliases `/fap` and `/ffap` are authorized push phrases. Ordinary `fap` runs `npm run finalise` then a normal fast-forward push; ordinary `ffap` runs `npm run finalise:full` then a normal fast-forward push. Protected CRITICAL / C9 releases still use `npm run finalise:push` / `npm run finalise:full:push`. The long phrases `finalise and push`, `finalise full and push`, `finalise:push`, and `push to GitHub` also authorize those complete-and-release paths. `/fixerrors` is a trusted operational command under safety contract `fixerrors-exact-snapshot-v4`: `npm run fixerrors` exports a repeatable-read snapshot of active `error_logs`, archives those exact IDs in the same process, then purges archived rows older than 12 months. `--no-clear` is rejected. `--cleanup` is crash-recovery archive only and must use the exact sealed snapshot identity.

Model registry version: `ffts-tee-model-registry-v1`.

### Local evidence retention and audited retirement

Protocol and workflow-state writers retain available commit evidence before publishing records in
direct, SHA-keyed `refs/ffts/workflow-evidence/<full-sha>` refs. This includes failed review candidates,
baselines, immutable route/import evidence and finalise results. Ref creation is atomic and
compare-and-swap checked; conflicting or symbolic refs fail the write. Missing legacy objects are
reported explicitly, never recreated or treated as passed evidence.

Audit existing records without mutation, then explicitly backfill available objects:

```bash
npm run workflow-protocol -- evidence-backfill --dry-run
npm run workflow-protocol -- evidence-backfill
```

Both commands report `available`, `missing` and `unpinned` commit arrays. `unpinned` describes the
pre-command state. Missing objects cause exit 1, including after apply has retained all available
objects; repeat apply is safe and does not hide the missing history. Disk/state divergence or unsafe
evidence fails closed. Status commands never pin objects or repair artifacts.

An owner may explicitly retire one obsolete missing legal review candidate only when its exhausted,
non-release rehome has an unambiguous, reciprocal, hash-bound local successor chain ending in a
genuinely passed and finalised successor already incorporated into current HEAD:

```bash
npm run workflow-protocol -- retire-evidence --workstream <historical-id> --missing-commit <full-sha> --reason "<owner-approved reason>" --owner-authorised-retirement --dry-run
npm run workflow-protocol -- retire-evidence --workstream <historical-id> --missing-commit <full-sha> --reason "<owner-approved reason>" --owner-authorised-retirement
npm run workflow-protocol -- status --blocking
```

This command does not recover the object, rewrite history, clear old blockers, grant review approval
or reset review budgets. It binds an append-only receipt to the complete original/successor records,
terminal passed review, passed finalise correlation and authorising HEAD. Intermediate discarded
imports need not be ancestors of HEAD. Every normal finalise gate revalidates the immutable chain,
all other required objects and current terminal incorporation; unrelated blockers remain enforced.

Receipts are ignored local files at `docs_private/automation/evidence-retirements/<id>.json`, sealed
as Git blobs under direct `refs/ffts/workflow-retirements/<id>` refs. Apply holds the workflow lock and
refuses pending transactions or active finalise. A crash after sealing but before writing the audit
mirror blocks status/finalise: replay the identical authorised command, with the same SHA and reason,
to restore that mirror. Dry run only diagnoses it. Conflicting replays, modified receipts, missing or
symbolic seals, malformed artifacts and later chain/finalise regressions block rather than overwrite
evidence. Preserve and investigate corrupt artifacts; do not hand-edit them to unblock release.

These refs protect locally against branch deletion, reflog expiration and ordinary Git GC/pruning.
They are not branches or tags, are not pushed automatically, and do not protect another clone.
They are not a backup or a security boundary against someone who can delete/rewrite local files and
refs. Back up the private audit files and dedicated ref namespaces together when moving a checkout.

## Automation Artifacts

`fixerrors` creates `docs_private/` when needed and writes ignored analysis, decision, fix-log, snapshot (`error-snapshot.json` / `error-snapshots/`), and structured automation-run files. The default command archives exact verified active snapshot IDs, then deletes only expired archived rows bound to a captured candidate set. It refuses automatic retry after failed or indeterminate archive/retention outcomes. Leftover v1 snapshots are rejected before any database connection. Debug UI clear and `scripts/clear-all-error-logs.ts` remain untrusted unbounded archive-active surfaces.

`finalise` preflights the three release artifacts before making a product commit:

- `lib/config/release-version.json`
- `lib/config/release-history.json`
- `docs_private/release-log.md`

The Markdown release log is the only tracked file under `docs_private/`. If release generation unexpectedly fails after the product commit, finalise blocks the push, preserves the local commit and generated files, and prints exact recovery commands. Authorised `--push` uses the C9-validated full SHA to `origin` `refs/heads/main` (`<sha>:refs/heads/main`). It does not use bare `git push`, mutable `HEAD`, or ambient upstream configuration. Ordinary (non-CRITICAL) persisting finalise does not require C9 identity; `--push` on that path is refused before mutation so bookkeeping cannot fail after a release commit. CRITICAL `finalise-start` bindings still require C9 for finish and push.

Exact finalise checkpointing reuses prior passed steps only when content/command/environment/artifact fingerprints match. Protocol-managed CRITICAL runs bind `activeFinaliseContext` after `workflow-protocol finalise-start`. Valid `split` ancestors and owner-authorised `successor_parked` parents are parked historical records. The active descendant owns remaining work; after two failed premium rounds that generation cannot take another normal final-diff pass. A legal owner-authorised successor can continue in the same checkout; a valid disposition or owner-directed DIRECT/TEE-LIGHT path must preserve failed history and resolve substantive blockers. Orphan/malformed splits still block. Do not launch a third premium review for the same CRITICAL continuation. Routing or split does not reset this budget. `finalise-start` requires current `HEAD` to match the reviewed `headCommit`; drifted HEAD must refresh via `workflow-protocol review-start --pass delta`. Rehomed dispositions revalidate against the recorded successor branch ref, not the current worktree checkout, so a later isolated successor in the same folder does not invalidate an earlier isolate whose branch still exists and remains isolated. Inspect blockers with `npm run workflow-protocol -- status --blocking`. Ordinary runs use `docs_private/automation/finalise-cache/`. The 45-minute mtime skip path remains an explicit compatibility fallback only (`allowLegacyMtimeFallback`).

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
`docs_private/invoices/invoice-<from>-to-<to>-final.md`, then exports the importable companion JSON:

```bash
npm run createinvoice -- --export-final "docs_private/invoices/invoice-<from>-to-<to>-final.md"
```

That writes `docs_private/invoices/invoice-<from>-to-<to>-final.json` in the same schema used by
invoice-software import. If a final Markdown file already exists for the requested dates, the
evidence command refreshes that companion JSON automatically. These private artifacts remain ignored
by Git. Use `--output-dir` only when a different local ignored destination is required.

If transcript discovery fails, verify the FFTS Cursor project directory or rerun with
`--transcripts-dir "<path>"`. Missing or incomplete release evidence should be corrected at its
FFTS source and the command rerun; do not copy release records, transcripts, credentials, or
generated auth state from another repository.

DIRECT/TEE-LIGHT is a workflow preference, not a bypass of FFTS mechanical release gates. This runtime supports explicit owner-authorised same-checkout successor generations; if another continuation mode lacks a supported transition, report the limitation and preserve the blocker.

## FFTS logo pack

Run `node scripts/branding/build-logo-pack.mjs` to regenerate `public/branding/` variants, `app/favicon.ico`, root SVG favicon/Apple/PWA assets and legacy `/images/forest-farm/` compatibility assets from the included original and centred branding masters. This is a local asset-only operation; it does not deploy or change data. SVGs embed raster artwork; see `public/branding/README.md` for usage and resolution limits. After changes, recreate the downloadable ZIP from the branding files (excluding the ZIP itself) plus `app/favicon.ico`, root SVG favicon and Apple/PWA icons.

Apple touch icons use the centred `ios-app-icon` leaf-and-FFTS variant. After regenerating icons, version the Apple icon URLs in `app/layout.tsx` and rebuild the downloadable pack. Login uses safe-area padding rather than a visual transform, so the status area and scrollable form remain separate.

The centred branding update uses `public/branding/logo-centered-dark.png` and `app-icon-centered-source.png` as separately maintained design masters. `build-logo-pack.mjs` derives Apple/Android icons and the social sharing card from these masters; the original horizontal artwork remains available for PDFs. Android maskable artwork is inset to preserve the mark inside the central safe zone. Rebuild the downloadable ZIP after regeneration.

## Fixerrors analysis and review

The `.cursor/commands/fixerrors.md` contract permits the premium parent or its assigned premium worker to analyze the captured snapshot and implement authorized repairs. It does not require a separate analysis Task or a second model review for every code change. The root selects independent review for material risk, unresolved uncertainty, an owner request or an applicable repository gate; workers never delegate. Keep targeted tests, parent acceptance, candidate-bound evidence and unresolved review blockers. The legacy review marker is emitted only when that selected review actually ran. Snapshot/decision validation, privacy, production authorization, recovery artifacts and release gates are unchanged; generated evidence stays under ignored `docs_private/`. Follow the command for project-specific mutation and recovery behavior.

Monthly advisor follow-ups now produce a premium lead handoff. Approval/rejection remains explicit, and non-interactive runs leave undecided suggestions pending. Approved plans stay repository-local; resolving a follow-up does not open Cursor, dispatch a worker or activate a schedule. The lead may dispatch only approved, scoped implementation through the installed premium runner, retains operational/release authority, and checks its completion evidence. Legacy Cursor stop-hook telemetry remains editor-specific and is not required for worker receipts.

Follow-up plan generation requires an explicit build-model recommendation and fails before authoring a plan if that contract field is absent. The generated handoff retains its premium implementation recommendation.

## NAS development tunnel

Run `npm run dev:nas:tunnel` from this repository on MPDEE-SERVER, then `npm run dev` in a second terminal. The tunnel uses SSH and the existing NAS Docker engine; it does not install Docker on the PC or alter services. It checks only the dedicated FFTS containers, their internal network/static destinations, free local ports and all four forwarded services. It stops on an occupied port, configuration mismatch or SSH forwarding denial. Ctrl+C closes its own tunnel.

Use `npm run testsuite:setup:development` to provision the three local testsuite accounts after target verification. The production setup alias is removed. Environment separation, generated private files, fixture confirmations, maintenance and recovery are documented in `docs/guides/LOCAL_DEVELOPMENT.md`; public NAS configuration is in `infra/nas-development/`. Never track runtime volumes, private `.env` files, copied data, auth state or backup archives.
