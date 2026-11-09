# Launch phases 1 and 2 — implementation handoff

Verified on 9 November 2026. The database permission fix is applied to the hosted client database and its separate NAS development copy. Local application/tooling changes are prepared on `main`; this work does not authorize a production build, push or deployment.

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

The isolated suite executes the actual migration in PGlite with real role/ACL denials, owner/service/nested-definer calls, repeat application, trusted search paths and MOT RLS. Route tests cover authorization and actor attribution; middleware tests preserve authentication on adjacent paths. Runtime checks establish local app identity, authorized scheduling reads, configured denials, actual service-role create/remove followed by rollback with unchanged job/project counts and number series, and Auth recovery email arriving in Mailpit. No production build or broad full-suite release validation was performed.

Evidence is on MPDEE-SERVER outside Git at `D:/_storage/Codex-Documents/2026-11-09/FFTS-Launch-Phases-1-2`: `permissions-apply-receipt.json`, `nas-runtime-verified.json`, `nas-bootstrap/restore-receipt.json`, `nas-bootstrap/storage-copy-receipt.json`, `parent-targeted-runtime.log`, `parent-typecheck-runtime.log`, `auth-runtime.log`, and `runtime-smoke-receipt.json`. Private backups in that directory must not be published or committed.

## Remaining launch work

1. Enable hosted leaked-password protection in Supabase Auth and recheck the security advisor. This setting was not changed because dashboard access was unavailable in the current connection.
2. Define intended team/module permissions for the manager and employee test roles, then provision those explicitly in the development environment before full role-workflow tests. Both retained test accounts currently have no team and Scheduling level 0 on hosted and NAS; their 403 responses are correct under that copied configuration. Login tests do not establish usable permissions for every module. Review actual staff team/role assignments before client onboarding.
3. Restore the five missing Realtime publication entries after checking their RLS and exercising them locally: `timesheets`, `van_inspections`, `plant_inspections`, `absences` and `message_recipients`. The app subscribes to these tables, but neither hosted nor NAS publishes them. This pre-existing gap can leave live lists and notification badges stale until refreshed. Use a targeted migration for the normal database release process; do not copy managed Realtime message partitions.
4. Run the remaining application workflow/release checks against NAS development data. Include normal quoting, scheduling, absences, fleet/inventory, documents and authorized/denied role actions. Supply explicit development credentials where external integration testing is needed.
5. Review and authorize the test build and production release separately. Apply only subsequently reviewed new migrations; do not replay the full baseline or reset the hosted project. A local commit does not update the production application.

The hosted sample cleanup was already completed before this implementation. The four retained hosted test identities remain protected; no cleanup is repeated by these phases. Resolve the open configuration/security items and complete the remaining release checks before the 20 December launch deadline.
