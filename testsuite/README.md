# FFTS Browser Testsuite

The dedicated `testsuite/` folder is the finalise smoke and workflow suite. It complements the main `tests/` Vitest workspace.

## Test Tiers

- API guards in `testsuite/api`
- Playwright UI workflows in `testsuite/ui`
- Shared deterministic fixtures and cleanup in `testsuite/helpers`

## Role Projects

`testsuite/config/playwright.config.ts` defines setup, unauthenticated auth, lifecycle, employee, manager, admin, permissions, and responsive projects.

## Prerequisites

`.env.local` must contain the required Supabase values and dedicated fictional test-user credentials. Provision test users once with:

```bash
npm run testsuite:setup
```

Run the application at `http://127.0.0.1:4000` before browser tests.

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
- Use fictional names, `example.test` addresses, and `ZZ99` fleet identifiers.
- Skip a workflow when its isolated prerequisites cannot be created safely.

Generated reports and auth state are written under ignored `testsuite/reports/` and `testsuite/.state/`.
