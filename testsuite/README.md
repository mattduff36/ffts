# FFTS Browser Testsuite

The dedicated `testsuite/` folder is the finalise smoke and workflow suite. It complements the main `tests/` Vitest workspace.

## Test Tiers

- API guards in `testsuite/api`
- Playwright UI workflows in `testsuite/ui`
- Shared deterministic fixtures and cleanup in `testsuite/helpers`

## Role Projects

`testsuite/config/playwright.config.ts` defines setup, unauthenticated auth, lifecycle, employee, manager, admin, permissions, and responsive projects.

## Prerequisites

`.env.local` must contain the Supabase values plus a strong local-only `TESTSUITE_SETUP_PASSWORD`. Never commit or print this password.

The setup script refuses a non-local Supabase target unless the production confirmation is explicit. Review the printed host and three fictional `@ffts.test` identities, then provision them with:

```bash
npm run testsuite:setup:production
```

The command is idempotent. It writes credentials only to ignored `testsuite/.state/test-users.json` after all three hidden profiles have been verified. Normal tests and `finalise --full` consume this state but never create accounts.

Every direct API/UI command and the combined runner performs a read-only preflight for state/account agreement, roles, permission modules, required tables, and fixture categories. API tests require the application at `http://127.0.0.1:4000`; Playwright starts or reuses it.

## Commands

```bash
npm run testsuite:api
npm run testsuite:ui
npm run testsuite
npx tsx testsuite/runner/run.ts --tag @fleet
npx tsx testsuite/runner/run.ts --grep "reminders"
```

## Data Safety

- Never edit or delete a pre-existing row.
- Tag created records with the current `TESTSUITE-<timestamp>` run tag.
- Register every created record with cleanup helpers.
- Use fictional names, approved `@ffts.test` addresses, and `ZZ99` fleet identifiers.
- Skip a workflow when its isolated prerequisites cannot be created safely.
- Treat cleanup residue as a failed run; investigate the printed table/id pairs rather than broadly deleting production rows.

Generated reports and auth state are written under ignored `testsuite/reports/` and `testsuite/.state/`.
