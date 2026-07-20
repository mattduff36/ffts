BEGIN;

ALTER TABLE public.faq_articles
  ADD COLUMN IF NOT EXISTS admin_only BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.faq_articles.admin_only IS
  'Restricts an FAQ article to actual Admin and Super Admin accounts.';

CREATE INDEX IF NOT EXISTS idx_faq_articles_admin_only
  ON public.faq_articles (admin_only)
  WHERE admin_only = TRUE;

DROP POLICY IF EXISTS "Authenticated users can view published FAQ articles"
  ON public.faq_articles;
DROP POLICY IF EXISTS "Admins can manage FAQ articles"
  ON public.faq_articles;
DROP POLICY IF EXISTS faq_articles_published_select
  ON public.faq_articles;
DROP POLICY IF EXISTS faq_articles_manage
  ON public.faq_articles;

CREATE POLICY faq_articles_published_select
  ON public.faq_articles
  FOR SELECT
  TO authenticated
  USING (
    is_published = TRUE
    AND (
      admin_only = FALSE
      OR EXISTS (
        SELECT 1
        FROM public.profiles AS profile
        LEFT JOIN public.roles AS role ON role.id = profile.role_id
        WHERE profile.id = (SELECT auth.uid())
          AND (
            profile.super_admin = TRUE
            OR role.is_super_admin = TRUE
            OR role.role_class = 'admin'
            OR LOWER(role.name) = 'admin'
          )
      )
    )
  );

CREATE POLICY faq_articles_manage
  ON public.faq_articles
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles AS profile
      LEFT JOIN public.roles AS role ON role.id = profile.role_id
      WHERE profile.id = (SELECT auth.uid())
        AND (
          profile.super_admin = TRUE
          OR role.is_super_admin = TRUE
          OR role.role_class = 'admin'
          OR LOWER(role.name) = 'admin'
          OR (
            admin_only = FALSE
            AND (
              role.is_manager_admin = TRUE
              OR LOWER(COALESCE(profile.role, '')) IN ('admin', 'manager')
            )
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles AS profile
      LEFT JOIN public.roles AS role ON role.id = profile.role_id
      WHERE profile.id = (SELECT auth.uid())
        AND (
          profile.super_admin = TRUE
          OR role.is_super_admin = TRUE
          OR role.role_class = 'admin'
          OR LOWER(role.name) = 'admin'
          OR (
            admin_only = FALSE
            AND (
              role.is_manager_admin = TRUE
              OR LOWER(COALESCE(profile.role, '')) IN ('admin', 'manager')
            )
          )
        )
    )
  );

INSERT INTO public.faq_categories (
  name,
  slug,
  description,
  module_name,
  sort_order,
  is_active
)
VALUES (
  'Admin Settings',
  'admin-settings',
  'Help for admin-only settings, maintenance, and operational scripts.',
  'admin-settings',
  20,
  TRUE
)
ON CONFLICT (slug) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  module_name = EXCLUDED.module_name,
  is_active = TRUE;

INSERT INTO public.faq_articles (
  category_id,
  title,
  slug,
  summary,
  content_md,
  is_published,
  admin_only,
  sort_order
)
SELECT
  category.id,
  'Running cleanup and administrator scripts safely',
  'admin-operational-cleanup-scripts',
  'Admin-only runbook for cleanup, validation, migration, test-account, error-review, and release scripts.',
  $md$# Running cleanup and administrator scripts safely

These commands are for **Admin and Super Admin operators only**. They run from a terminal in the FFTS repository root; they do not run from the Help page.

## Before running any production script

1. Confirm the terminal is in the FFTS repository.
2. Confirm `.env.local` targets the intended Supabase project. Never paste credentials into chat, logs, screenshots, or command history.
3. Read the matching runbook and review the script before running it.
4. Take or confirm a recoverable database backup before migrations, cleanup, hierarchy changes, or bootstrap work.
5. Use a dry run or plan command first whenever one exists.
6. Record the operator, date, target, expected row counts, confirmation token, and recovery command.
7. Stop immediately if the target, ownership markers, counts, validation, build, or tests differ from the approved plan.

## Scheduling sample-data cleanup

The scheduling fixture owns only rows marked `scheduling-sample-v1`. Read `docs/guides/SCHEDULING_SAMPLE_DATA_RUNBOOK.md` before using it.

Preview the owned rows without deleting anything:

```bash
npm run scheduling:sample:cleanup -- --dry-run
```

Expected installed-fixture counts are normally 1 placeholder profile, 5 customers, 22 Quotes, 22 synchronized jobs, 36 visits, and 0 employee or plant assignments.

After checking those counts and receiving explicit production approval, remove the fixture:

```bash
npm run scheduling:sample:cleanup -- --confirm-production=FFTS_SCHEDULING_SAMPLE
```

Cleanup refuses to continue if ownership markers do not identify exactly one SAMPLE identity or if a sample visit has acquired a resource assignment. Do not weaken those checks. Investigate the unexpected records instead.

To plan or recreate the fixture, use:

```bash
npm run scheduling:sample:plan
npm run scheduling:sample:apply -- --confirm-production=FFTS_SCHEDULING_SAMPLE
```

The apply command is not a routine reset. Report the target project, date window, identity, series, and planned counts before requesting approval.

## Safe validation commands

These commands do not intentionally modify production business records:

```bash
npm run db:validate
npm run typecheck
npm run typecheck:tests
npm run lint
npm run build
npm run verify:data-safety
```

Run `npm run db:validate` after every schema migration. Run typechecks, lint, focused tests, and a clean build before release.

## Production error review

```bash
npm run fixerrors -- --no-clear
```

Use `--no-clear` when reviewing and generating private error-analysis artifacts without clearing production error rows. Run plain `npm run fixerrors` only when the active cleanup procedure explicitly requires its normal clearing behaviour. Read the generated files under `docs_private/` and never publish private logs.

## Test accounts

Local or approved non-production setup:

```bash
npm run testsuite:setup
```

Production test-account setup requires the protected command:

```bash
npm run testsuite:setup:production
```

This command may create or update only testsuite-specific accounts. Confirm the target and follow `testsuite/README.md`; never substitute a real employee account.

## Database and storage administration

Use only the migration runner named in the relevant runbook. Examples include:

```bash
npm run scheduling:migrate:visits
npm run permissions:migrate:team-matrix
npm run setup:storage
```

`npm run db:baseline`, `npm run forest:bootstrap-production`, and hierarchy migration/cutover commands are one-time or exceptional operations. Do not run them as routine maintenance. They require a reviewed change plan, backup, target verification, and explicit approval.

Historical files whose names contain `cleanup`, `migration`, `backfill`, `cutover`, or `bootstrap` are not a menu of general-purpose tools. Run one only when its dedicated issue or runbook names the exact file and recovery procedure.

## Release automation

```bash
npm run finalise
npm run finalise:full
```

Finalise validates, cleans up generated artifacts, updates release metadata, and creates local release commits. It does not authorize a GitHub push. Use a `:push` command only after the exact push contents have been reported and an operator has explicitly approved the push.

## If a command fails

- Do not retry a mutating command blindly.
- Preserve the terminal output and local work without exposing secrets.
- Check whether the command committed a transaction or printed a recovery command.
- Run only documented read-only validation.
- Escalate unexpected ownership, count, authentication, schema, or partial-commit results before continuing.

When in doubt, stop. A delayed cleanup is safer than deleting or migrating data whose ownership is uncertain.$md$,
  TRUE,
  TRUE,
  100
FROM public.faq_categories AS category
WHERE category.slug = 'admin-settings'
ON CONFLICT (category_id, slug) DO UPDATE
SET
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  content_md = EXCLUDED.content_md,
  is_published = TRUE,
  admin_only = TRUE,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();

COMMIT;
