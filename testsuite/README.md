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

### Isolated scheduling responsive fixtures

These checks do not start Next.js, load application authentication or contact Supabase. They render the real manager board and dialogs in an isolated Vite shell; every API request is fulfilled with fictional in-memory data, and unexpected/external requests fail the check. No credentials, account provisioning or database writes are required.

Run in separate terminals:

```powershell
npx vite --config testsuite\isolated-scheduling\vite.config.mjs
npx playwright test --config testsuite\isolated-scheduling\playwright.config.ts
```

Open `http://127.0.0.1:4017/?fixtures=1&date=2026-11-05` for standalone review. The `fixtures` flag installs the same in-memory data in the isolated shell only; removal/completion changes reset on reload, other saves fail explicitly, and no application authentication bypass exists. The harness uses installed Microsoft Edge and reserves the same 132px vertical shell budget plus sidebar space as the scheduling page. Screenshots of both layouts, calendar scroll positions and Quick add at 390x844, 768x1024, 1024x768, 1280x720 and 1440x900 go to ignored `testsuite\reports\scheduling-local\screenshots\`; test output goes to `testsuite\reports\scheduling-local\results\`. Removal checks cover cancellation, overlapping pending job edits, success and denied/conflicting/ambiguous errors without changing a real database. SQL contract tests do not substitute for approved migration execution or database concurrency testing. Typecheck this isolated fixture and its imported application components with `npx tsc --noEmit --project testsuite\isolated-scheduling\tsconfig.json`.

Jobs-primary daily and weekly checks verify that timeline/day columns use the removed label rail's space, while scheduled visit cards retain identity, staffing (including untimed assignments) and compact job menus. Jobs without a visit in the displayed day/week stay off the calendar and remain available in Resources. Coverage includes 1280x720, portrait and narrow layouts, short-card keyboard/pointer isolation, source-specific controls, removal confirmation, fit/scroll move/resize coordinates, scrolled quote-drop coordinates, and unchanged Teams/Plant axes and Resources. Related screenshots use `jobs-no-column-*.png` in the directory above. All tested saves are intercepted and update only fictional fixture data.

- Never edit or delete a pre-existing row.
- Tag created records with the current `TESTSUITE-<timestamp>` run tag.
- Register every created record with cleanup helpers.
- Use fictional names, approved `@ffts.test` addresses, and `ZZ99` fleet identifiers.
- Skip a workflow when its isolated prerequisites cannot be created safely.
- Treat cleanup residue as a failed run; investigate the printed table/id pairs rather than broadly deleting production rows.

Generated reports and auth state are written under ignored `testsuite/reports/` and `testsuite/.state/`.

Scheduling smoke coverage includes the retirement of crew-offer controls. Meeting preview checks must preserve existing sample records and keep their test artifacts under `testsuite/reports/`.
