# Testsuite And Automation Parity Contract

This document is the canonical implementation input for making the FFTS testsuite, `finalise`, and `fixerrors` workflows reliable and self-contained.

It records the behavior observed in the temporary, read-only AVS Worklog reference repository and translates that behavior into Forest Farm requirements. It is not an instruction to copy AVS production data or retain AVS as a dependency.

## Status And Decisions

- **Status:** implemented in FFTS; this document remains the safety and verification contract.
- **Target application:** Forest Farm Operations (`ffts`).
- **Testsuite target:** the Forest Farm production Supabase project, explicitly authorized for the limited fictional fixtures defined below.
- **Persistent login fixtures:** three hidden testsuite accounts only.
- **Pagination coverage:** deterministic mocked coverage for responses larger than 1,000 rows; do not manufacture 1,000 production permission rows.
- **Automation scope:** testsuite, `finalise`, `fixerrors`, private logs, release metadata, and Cursor workflow rules.
- **Reference lifetime:** `D:\Websites\avsworklog` is temporary and will be removed from the workspace after implementation.

Implemented outcomes include explicit production testsuite confirmation and preflight, deterministic mocked pagination coverage, strict fixture cleanup, `fixerrors --no-clear`, tracked release-log consistency checks, fail-closed finalise recovery, release-version stale-client detection, and self-contained Cursor rules.

## Source Boundary

The AVS Worklog repository may be inspected during planning and implementation, but it remains read-only.

Never copy any of the following into FFTS:

- environment files, Supabase URLs, keys, tokens, passwords, or generated auth state;
- AVS employee, customer, fleet, inspection, quote, or permission rows;
- AVS testsuite account credentials;
- AVS private release history, automation runs, incident reports, or repair maps;
- Squires branding, domains, fleet prefixes, terminal paths, or deployment identifiers;
- generated plans, reports, screenshots, or private operational artifacts.

Reusable information is limited to code structure, workflow ordering, fixture patterns, cleanup patterns, rule intent, and empty-file scaffolding. All resulting files must use Forest Farm terminology and fictional FFTS identifiers.

## Independence Invariant

The completed implementation must work after `D:\Websites\avsworklog` is removed from the Cursor workspace and is unavailable on disk.

No FFTS runtime, test, script, rule, documentation link, workspace task, or verification command may:

- import from the AVS repository;
- read an AVS file at runtime;
- use `../avsworklog` or an absolute AVS path;
- require an AVS-generated state or log file;
- rely on Squires-specific data already existing in a database.

Historical provenance may be mentioned in this document as plain text. It must not be an operational dependency.

## Existing FFTS Architecture

FFTS already contains the main testsuite architecture:

- `testsuite/config/playwright.config.ts` defines role-scoped browser projects and starts the app on port 4000.
- `testsuite/config/vitest.config.ts` runs API tests.
- `testsuite/helpers/auth.ts` reads generated local credentials and creates Playwright storage state.
- `testsuite/helpers/data.ts` creates tagged fictional records and tracks cleanup.
- `testsuite/helpers/sensitive-access.ts` supports test-only sensitive-module sessions.
- `testsuite/runner/run.ts` coordinates API tests, browser tests, reports, and the auth-lifecycle gate.
- `scripts/setup-test-users.ts` provisions admin, manager, and employee testsuite identities.
- `testsuite/api` and `testsuite/ui` contain the API and browser workflows.

FFTS also has one product-specific scheduling browser test that is not part of the historical reference implementation. It remains an FFTS requirement.

The missing behavior is operational scaffolding and deterministic data preparation, not a replacement test framework.

## Testsuite Data Contract

### Persistent Production Records

Only these persistent testsuite identities are permitted:

- testsuite admin;
- testsuite manager;
- testsuite employee.

The implementation must use the existing FFTS fictional account definitions and must not document or commit their password. The accounts must:

- use the FFTS test domain;
- be email-confirmed;
- have the intended role;
- have `is_placeholder = true`;
- have `must_change_password = false`;
- be recognized by `lib/utils/system-test-accounts.ts`;
- remain hidden from normal employee/admin lists;
- be idempotently created or updated by `scripts/setup-test-users.ts`.

The setup command may write credentials only to the ignored `testsuite/.state/test-users.json` file. Playwright storage snapshots remain under the ignored `testsuite/.state/` directory.

### Explicit Production Confirmation

Because `.env.local` points to production, testsuite provisioning must not run accidentally.

The implementation plan must add a deliberate production confirmation mechanism to `scripts/setup-test-users.ts`. The preferred interface is an explicit CLI confirmation, not a committed environment value. The script must:

1. identify whether the configured Supabase URL is non-local;
2. refuse production provisioning without the exact confirmation argument;
3. print the project host and the fictional records it will create, without printing secrets;
4. reject an AVS/Squires project host or account domain;
5. remain idempotent when rerun;
6. stop before writing local state if any account failed to provision correctly.

Normal `npm run testsuite` and `finalise --full` must never silently create accounts. They may consume previously provisioned state and must fail with an actionable setup command when state is absent.

### Per-Run Records

All non-auth data created during a testsuite run must:

- use a `TESTSUITE-<timestamp>` run tag;
- use fictional values and `ZZ99` fleet identifiers;
- be registered with cleanup immediately after creation;
- avoid editing or deleting pre-existing production rows;
- be deleted in reverse dependency order;
- report cleanup failures clearly;
- be discoverable by a stale-fixture audit if a process crashes.

Where a workflow cannot create an isolated prerequisite safely, the test should skip with a specific reason rather than repurpose a real production row.

### Required Baseline Checks

Before authenticated API/UI workflows run, preflight must verify:

- admin, manager, and employee role records exist;
- permission modules are populated;
- the `error_logs` table and required application tables exist;
- at least one suitable van category exists for tagged vehicle fixtures;
- at least one suitable workshop-task category exists for tagged task fixtures;
- the three testsuite accounts and local state file agree;
- the application base URL is reachable.

Missing structural prerequisites must produce actionable failures. The implementation must not copy AVS categories or live rows to satisfy them.

### Optional Fleet Coverage

`ZZ99 VAN`, `ZZ99 HGV`, and `ZZ99 PNT` are the only permitted persistent-style fleet identifiers for tests. Any future seed command must be:

- FFTS-specific;
- explicitly invoked;
- idempotent;
- restricted to the `ZZ99` namespace;
- paired with scoped cleanup or archive behavior;
- unnecessary for the core testsuite pass.

Tests that need optional fleet history may continue to skip when safe isolated fixtures cannot be prepared.

## Permission Pagination Contract

The current live regression test assumes `user_module_permissions` contains more than 1,000 rows. That assumption is invalid for a newly sanitized Forest Farm database and must not be satisfied by polluting production.

The implementation must split coverage into two layers:

1. **Deterministic pagination test**
   - Simulate more than 1,000 permission rows.
   - Exercise at least two Supabase-style ranges/pages.
   - Verify no rows are lost or duplicated.
   - Verify the loop terminates on a short final page.
   - Run without database writes.

2. **Live matrix integration test**
   - Load the actual production permission matrix.
   - Compare every existing persisted override with the effective user result.
   - Require at least one meaningful checked row when the fixture setup supplies one.
   - Do not require production row count to exceed 1,000.

The production testsuite must retain integration coverage while moving the artificial volume requirement to an injected or mocked data source. A subsequent implementation plan should determine the narrowest testable boundary in `lib/server/team-permissions.ts`.

## Auth And Browser Contract

`testsuite/ui/auth.setup.ts` must successfully create storage state for all three roles before dependent projects run.

Acceptance behavior:

- each account can complete password login;
- no account is redirected to mandatory password change;
- role-scoped routes enforce the expected permission level;
- storage-state files are regenerated when stale or missing;
- auth lifecycle issues are written to the testsuite issue log;
- the final auth-lifecycle gate reports unresolved issues;
- credentials and access tokens never appear in committed reports.

## Cleanup And Failure Recovery

The testsuite must distinguish persistent account fixtures from per-run data.

- Persistent testsuite accounts are updated by setup and are not deleted by normal test cleanup.
- Per-run records are always registered and removed by helper cleanup.
- Error-log tests remove only logs carrying their unique marker and created after their recorded start time.
- A failed run preserves enough run-tag information to identify stale fictional fixtures.
- Cleanup must never use broad deletes based only on dates, common names, or table-wide status.
- Cleanup failure must make the test/run fail rather than being hidden as a warning when production residue may remain.

## Testsuite Command Contract

The existing commands remain canonical:

```bash
npm run testsuite:setup
npm run testsuite:setup:production
npm run testsuite:api
npm run testsuite:ui
npm run testsuite
npx tsx testsuite/runner/run.ts --tag @fleet
npx tsx testsuite/runner/run.ts --grep "reminders"
```

Use `testsuite:setup:production` for the explicit remote confirmation. Neither the confirmation token nor account password is stored in committed files.

`npm run finalise:full` and `npm run finalise:full:push` must:

- run the clean production build;
- run the normal Vitest suite;
- run the dedicated testsuite using existing provisioned state;
- stop before commit/push on any test or cleanup failure;
- provide a concise failing-step summary and artifact paths.

## Automation Artifact Contract

### Tracked Release Artifacts

These files form one release metadata unit:

- `lib/config/release-version.json`;
- `lib/config/release-history.json`;
- `docs_private/release-log.md`.

`docs_private/release-log.md` must be the only tracked file under `docs_private/`. Its initial FFTS content is:

```markdown
# Production release log

Private changelog for production builds. Newest entries first.
```

The `.gitignore` policy required by the future implementation is:

```gitignore
# private documentation and sensitive materials
/docs_private/*
!/docs_private/release-log.md
```

The release step must stage and commit all changed members of the release metadata unit together. A version bump must fail before push if the release log is unexpectedly ignored, missing, or inconsistent with the JSON metadata.

### Ignored Private Artifacts

These outputs remain local and ignored:

- `docs_private/error-analysis.md`;
- `docs_private/error-fix-log.md`;
- `docs_private/automation/runs/**`;
- `docs_private/automation/reviews/**`;
- `docs_private/automation/follow-ups/**`;
- generated automation plans and pending-decision artifacts.

No private error payload, stack trace, session state, credential, or production row belongs in public documentation or release history.

### Directory Bootstrap

Every writer must create its own parent directory before writing. It must not rely on a previously tracked file or earlier automation run to have created `docs_private/`.

In particular:

- `fixerrors` must ensure `docs_private/` exists before writing analysis/fix logs;
- the automation logger must ensure its run/review directories exist;
- release bump logic must ensure the release-log directory exists;
- monthly follow-up logic must ensure its pending/review directories exist.

## `fixerrors` Contract

`npm run fixerrors` must:

1. load production configuration from `.env.local`;
2. verify required Supabase values without printing them;
3. fetch and group recent production errors;
4. write `docs_private/error-analysis.md`;
5. create or update `docs_private/error-fix-log.md`;
6. write structured automation run logs;
7. validate required artifacts during self-review;
8. clear or mark remote errors only after local output succeeds;
9. report the local artifact paths and any monthly follow-up.

An empty error set is a successful, logged outcome. Missing `docs_private/` is not a valid failure mode.

## `finalise` Contract

The existing pipeline order remains:

1. check for competing repository activity;
2. stop the repository dev server;
3. run pending local migrations when applicable;
4. validate schema-risk migrations;
5. run or safely reuse a recent clean production build;
6. run full tests only for full mode;
7. summarize workspace changes;
8. commit product changes;
9. calculate and commit release metadata;
10. push only when explicitly authorized;
11. finish the automation log and print timing/self-review output.

Required hardening:

- preflight the release log's git tracking policy before creating the product commit;
- never leave a successful product commit with a failed, partially staged release bump;
- record whether product and release commits were created or skipped;
- record whether push was requested, skipped, or completed;
- make generated log paths available even on failure;
- treat a full-testsuite failure as a no-push result;
- preserve the user's unrelated working-tree changes.

## Cursor Rule Contract

The future FFTS implementation should add self-contained project rules under `.cursor/rules/`.

### Finalise Rule

The finalise rule must:

- map `finalise`, `finalise full`, and their push variants to the existing npm scripts;
- inspect current repository activity before launching;
- avoid starting duplicate finalise processes;
- surface changed files and the planned push contents;
- obey the user's current push authorization rule;
- treat `finalise and push`, `finalise with push`, and `finalise:push` as explicit push requests when the global user rule permits them;
- never push after failed build, test, cleanup, release, or commit steps;
- read the generated finalise run summary and report its artifact path.

### Fixerrors Rule

The fixerrors rule must:

- run the existing `npm run fixerrors` command;
- read the generated `docs_private/error-analysis.md`;
- inspect `docs_private/error-fix-log.md` when present;
- summarize actionable groups without exposing sensitive payloads;
- use automation review/follow-up files when generated;
- avoid claiming remote errors were cleared unless the run log confirms it;
- never require the AVS workspace or AVS terminal directory.

### Rule Portability

Rules must use repository-relative commands and dynamic workspace/terminal context. They must not embed:

- `d-Websites-avsworklog`;
- `D:\Websites\avsworklog`;
- Squires product names;
- AVS deployment URLs;
- AVS account identifiers.

## File-Level Implementation Inventory

A subsequent implementation plan should evaluate these FFTS targets.

### Testsuite

- `scripts/setup-test-users.ts`
  - production confirmation;
  - idempotent account verification;
  - state-file integrity;
  - actionable preflight output.
- `testsuite/helpers/auth.ts`
  - stale/missing state diagnostics;
  - no secret leakage.
- `testsuite/helpers/data.ts`
  - complete registration and reverse cleanup;
  - stale-fixture markers.
- `testsuite/api/permissions.test.ts`
  - remove the live `>1000` assumption;
  - retain live matrix assertions.
- `lib/server/team-permissions.ts`
  - expose or inject the narrow pagination boundary needed by deterministic tests.
- `tests/unit/`
  - add pagination tests that simulate multiple result pages.
- `testsuite/README.md`
  - production setup confirmation, prerequisites, commands, cleanup, and troubleshooting.
- `lib/utils/system-test-accounts.ts`
  - verify all three persistent testsuite accounts remain hidden.

### Automation

- `.gitignore`
  - track only `docs_private/release-log.md`.
- `docs_private/release-log.md`
  - add the empty Forest Farm release-log preamble.
- `scripts/fixerrors.ts`
  - create output directories before writing;
  - retain artifact validation.
- `scripts/finalise.ts`
  - preflight and atomically handle release metadata;
  - improve failed-step outcome metadata.
- `scripts/bump-release-version.ts`
  - preserve Forest Farm wording and release-log consistency.
- `scripts/automation/logger.ts`
  - retain run JSON/Markdown output and failure paths.
- `.cursor/rules/finalise-commands.mdc`
  - add an FFTS-only orchestration rule.
- `.cursor/rules/fixerrors.mdc`
  - add an FFTS-only analysis/follow-up rule.
- `README-SETUP-FFTS.md`, `scripts/README.md`, and `testsuite/README.md`
  - document the resulting operational workflow.

### Workspace Independence

- `ffts.code-workspace`
  - remove the temporary `../avsworklog` folder entry after implementation verification.
- all executable/configuration files
  - contain no AVS paths, imports, or runtime dependencies.

## Recommended Implementation Sequence

1. Add release-log tracking and directory bootstrap.
2. Harden release staging so `finalise` cannot create a partial release outcome.
3. Add FFTS Cursor rules for `finalise` and `fixerrors`.
4. Harden production testsuite setup and local state validation.
5. Split pagination volume coverage from live production integration coverage.
6. Verify tagged fixture cleanup and testsuite prerequisites.
7. Run API and browser tests independently.
8. Run standard and full finalise dry runs.
9. Run `fixerrors` with both empty and non-empty error inputs where safe.
10. Remove AVS from `ffts.code-workspace`.
11. scan for forbidden AVS references;
12. rerun all acceptance gates using FFTS alone.

## Acceptance Criteria

### Testsuite

- `npm run testsuite:setup` refuses an unconfirmed production target.
- Confirmed setup creates or updates exactly the three hidden fictional accounts and writes ignored local state.
- Repeated setup is idempotent.
- API and UI suites authenticate all three roles.
- The pagination regression covers more than 1,000 mocked rows without production volume fixtures.
- Live permission integration assertions pass against the actual number of rows.
- Per-run records are tagged and cleaned.
- No pre-existing production record is modified or deleted.
- `npm run testsuite` produces a report and passes its auth-lifecycle gate.

### Finalise And Fixerrors

- `fixerrors` succeeds when `docs_private/` did not exist before the run.
- Required private logs are created and remain ignored.
- Automation run JSON and Markdown are written for success and failure.
- Monthly review/follow-up artifacts are generated when due.
- Release version JSON, history JSON, and markdown log remain consistent.
- Standard finalise can commit and push when authorized.
- Full finalise stops before commit/push when the testsuite fails.
- Successful full finalise completes without manual artifact repair.

### Independence

After removing `D:\Websites\avsworklog` from the workspace:

- FFTS installs, builds, and typechecks;
- testsuite setup and execution use FFTS files only;
- `fixerrors` writes and reads its own artifacts;
- `finalise` writes its logs and release metadata;
- Cursor rules resolve only FFTS commands and paths;
- no executable/configuration file contains `avsworklog`, Squires branding, `../avsworklog`, or an absolute AVS path.

Suggested verification searches:

```bash
rg -n -i "avsworklog|squires|d-Websites-avsworklog|\\.\\./avsworklog" \
  app components lib scripts tests testsuite .cursor package.json ffts.code-workspace
```

Historical provenance in this document is allowed. Any operational match elsewhere must be removed or explicitly justified.

## Non-Goals

- copying AVS production data or release history;
- turning FFTS back into a demo application;
- adding reset/wipe scripts;
- creating more than the three approved persistent testsuite login accounts;
- creating 1,000 production permission rows for a pagination test;
- tracking private automation/error output;
- changing AVS Worklog;
- keeping AVS Worklog in the FFTS workspace after parity verification.

## Planning Handoff

The next implementation plan should be produced from this contract and should:

1. inspect the listed FFTS target files at their current revisions;
2. split work into testsuite, automation, rules/docs, and independence phases;
3. identify every production mutation before execution;
4. include rollback for the three persistent testsuite accounts and any tagged fixtures;
5. verify each phase before proceeding to finalise;
6. make no edits under `D:\Websites\avsworklog`.
