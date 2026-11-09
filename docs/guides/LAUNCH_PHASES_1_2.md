# Launch phases 1 and 2 — implementation handoff

Verified on 9 November 2026. The original permission fix is applied to hosted and NAS databases. The phase 1/2 application and tooling changes were subsequently released from `main` at `064483ec422a37871224abce4c05f23ec4b544cf` following the owner's deployment request. Later staff restoration and the admin account-handover workflow are described below; the remaining launch checks still apply.

## Phase 1: database permissions

Migration: `supabase/migrations/20261109151246_launch_function_permissions.sql`.

SHA-256: `cb25ae47aaac403708fe07f4e45a9d72305a1ae3ebec877df64985359d31ed12`.

The parent applied the reviewed migration to the hosted database at `2026-11-09T15:54:10.611Z`, using the repository's explicit `pg.Client` transaction path. Before/after fingerprints matched for all 170 checked application/Auth tables. No business records or retained identities were changed by this migration. Private function/ACL backups, rollback SQL and the application receipt are outside Git.

- Six mutators are service-role/owner only: scheduling create/remove, usage retention/rollup, and carryover recalculate/snapshot. PUBLIC, anonymous and ordinary authenticated execution is revoked.
- Four metadata readers retain authenticated/service access but no longer allow anonymous/PUBLIC execution.
- Selected function search paths are pinned to trusted schemas. CREATE on `public` is revoked from PUBLIC, anonymous and authenticated roles so those roles cannot plant objects in a trusted search path.
- The two MOT readers use SECURITY INVOKER, so underlying table RLS applies.
- Existing authorized server routes and owner-executed nested functions retain access. No blanket revocation was applied to legitimate role/permission/RLS helpers.

The post-migration advisor check no longer reports mutable function search paths. Remaining definer/helper advisory categories are not an instruction to revoke every function indiscriminately. Hosted leaked-password protection remains disabled and requires the Supabase Auth dashboard setting; the connected tools did not provide access to change it. This remains an open launch-security item.

## Phase 2: isolated development

The NAS runs the dedicated `ffts-development` Compose project under `/home/admin/ffts-development`, separate from the camera allocation and previous Docker workloads. Ten healthy containers use one internal network, no published ports, independent secrets and bounded logs. SSH forwarding is restricted by the NAS administrator to the four documented private destinations. MPDEE-SERVER runs the app and SSH client without a Docker engine.

The initial database copy includes 168 public tables, seven retained Auth identities, 18 customers, 34 quotes and 43 jobs. The custom Auth trigger, 17 Storage policies, six buckets and three PDFs were restored. All 378 public foreign keys and all copied file hashes passed validation. Existing Realtime publication membership matches hosted, and the three attachment paths resolve to copied Storage objects without hosted URL rewrites. Hosted active sessions/tokens were not carried into usable development sessions; copied app sessions, PIN unlocks, passkeys and device-pairing state were cleared. The permission migration was reapplied after restoring the dump's ACLs.

`.env.local` and `.env.development.local` now use only NAS credentials and loopback endpoints. Hosted settings are preserved in ignored `.env.ffts-hosted.local`. Development session/cron/database/JWT secrets are independent. External email, vehicle, fleet and map credentials are blank locally; Auth email is captured by Mailpit. The existing application email provider is disabled locally rather than rerouted implicitly.

The shared guard protects fixture SQL/Auth clients, CLI inspection/mutation/cleanup, test-user setup and testsuite execution. It checks exact targets, aliases, key issuer/project/role claims and PostgreSQL connection options before clients or writes. Legacy production confirmations cannot override it. The running app exposes a credential-free development identity only after validation; middleware permits only that exact route before Auth. Preflight verifies the app and tooling agree. Ordinary test runs cannot implicitly load hosted credentials or use real clients/network.

Daily commands and maintenance details are in [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md). The NAS public configuration and source provenance are in `infra/nas-development/`. Use `npm run dev:nas:tunnel`, then `npm run dev`. The tunnel command verifies service ownership, health, isolation, addresses and actual forwarded connectivity.

## Verification

| Check | Result |
| --- | --- |
| Isolated launch suite, 11 files | 131 passed |
| TypeScript `--noEmit --incremental false` | Passed |
| Browser sign-in/setup for admin, manager, employee; login failure and unauthenticated redirect | 6 passed |
| Local HTTP/SQL/SMTP runtime checks | 11 passed |
| Database-copy foreign keys | 378 checked, no violations |
| Storage-copy integrity | 3 of 3 SHA-256 hashes matched |
| Hosted permission-migration data fingerprints | 170 tables unchanged |

The isolated suite executes the actual migration in PGlite with real role/ACL denials, owner/service/nested-definer calls, repeat application, trusted search paths and MOT RLS. Route tests cover authorization and actor attribution; middleware tests preserve authentication on adjacent paths. Runtime checks establish local app identity, authorized scheduling reads, configured denials, actual service-role create/remove followed by rollback with unchanged job/project counts and number series, and Auth recovery email arriving in Mailpit. These were the initial implementation checks; the subsequent authorised production release used the standard finalise/build gate. They do not constitute the broader application workflow acceptance still listed below.

Evidence is on MPDEE-SERVER outside Git at `D:/_storage/Codex-Documents/2026-11-09/FFTS-Launch-Phases-1-2`: `permissions-apply-receipt.json`, `nas-runtime-verified.json`, `nas-bootstrap/restore-receipt.json`, `nas-bootstrap/storage-copy-receipt.json`, `parent-targeted-runtime.log`, `parent-typecheck-runtime.log`, `auth-runtime.log`, and `runtime-smoke-receipt.json`. Private backups in that directory must not be published or committed.

## Remaining launch work

Launch hardening follow-up on 9 November 2026:

- Hosted public sign-up was verified disabled via the Auth settings endpoint. The owner confirmed enabling leaked-password protection in the dashboard.
- The development Manager and Employee are assigned to Civils. Scheduling resolved to level 4 with board access for Manager and level 2 with HTTP 403 on the manager board for Employee.
- The five Realtime entries below are present on NAS and hosted, together with the four previous entries. NAS used repository migration `20261109203007_enable_core_realtime_publications.sql`. Hosted records the same SQL under version `20261109210618`. Do not replay or repair migration history just to align those version numbers.
- NAS verification used the FFTS app data token to receive a `message_recipients` update and restore the original value. The five hosted tables still have RLS and read policies. Supabase Postgres Changes can deliver DELETE primary keys without row-policy filtering. No hosted event was generated for testing.
- Follow-up migration `20261109222000_harden_core_realtime_delivery.sql` disables DELETE delivery across the nine tables in the shared feed while retaining live creates and updates. On NAS, the migration also repaired the workshop permission helper so the Civils Manager received both create and update events for van and plant inspections. A deletion made elsewhere appears on the next normal refresh.

The list below records the original launch checklist.

1. Disable public sign-up and enable hosted leaked-password protection in Supabase Auth, then recheck the configuration and security advisor. Public sign-up was still enabled during the account-handover audit. The current connection has no authenticated dashboard or Auth-configuration API access, so these settings remain open.
2. Define intended team/module permissions for the manager and employee test roles, then provision those explicitly in the development environment before full role-workflow tests. Both retained test accounts currently have no team and Scheduling level 0 on hosted and NAS; their 403 responses are correct under that copied configuration. Login tests do not establish usable permissions for every module. Review actual staff team/role assignments before client onboarding.
3. Restore the five missing Realtime publication entries after checking their RLS and exercising them locally: `timesheets`, `van_inspections`, `plant_inspections`, `absences` and `message_recipients`. The app subscribes to these tables, but neither hosted nor NAS publishes them. This pre-existing gap can leave live lists and notification badges stale until refreshed. Use a targeted migration for the normal database release process; do not copy managed Realtime message partitions.
4. Run the remaining application workflow/release checks against NAS development data. Include normal quoting, scheduling, absences, fleet/inventory, documents and authorized/denied role actions. Supply explicit development credentials where external integration testing is needed.
5. Complete release checks for each authorised subsequent change and verify the intended commit is serving production. The initial phase 1/2 release is complete. Apply only reviewed new migrations in their documented order; do not replay the full baseline or reset the hosted project.

The hosted sample cleanup was already completed before this implementation. The four retained hosted test identities remain protected; no cleanup is repeated by these phases. Resolve the open configuration/security items and complete the remaining release checks before the 20 December launch deadline.

## Staff restoration and account handover

At the owner's request, 17 removed staff Auth identities and their original profile IDs were restored additively to hosted and NAS databases from the encrypted pre-cleanup backup. Recovery included 135 assignments to surviving jobs, 96 day-team memberships, six slot-leader entries, 17 work-shift rows and 44 reporting lines. The 52 assignments belonging to deleted sample jobs were excluded; those jobs were not recreated. The saved password state was preserved, pending Auth action tokens were cleared, and sessions/biometrics were not restored. No password emails were sent. Hosted Auth API verification found all 17 original identity/email pairs and 24 accounts in total. Private recovery receipts remain outside Git in the FFTS-Sample-Cleanup operation directory.

The new admin handover action changes the email and generates a temporary password on the same account, revokes previous application/biometric access and requires a permanent password before business access. Both credential routes share an account-scoped PostgreSQL transaction lock. The related profile permission migration is `20261109190808_staff_account_handover_guards.sql`; see [USER_ACCOUNT_HANDOVER.md](USER_ACCOUNT_HANDOVER.md) for operation, failure recovery, deployment ordering and the existing direct-token lifetime limitation. These changes do not replace the broader workflow tests or the Auth-setting tasks above.
