# FFTS development on the NAS

## Daily use on MPDEE-SERVER

From the FFTS repository, open two terminals:

```powershell
# Terminal 1: verify the dedicated NAS containers and keep SSH forwarding open.
npm run dev:nas:tunnel

# Terminal 2: run the local application against the NAS.
npm run dev
```

If the tunnel and app are already running, use them; the tunnel command deliberately refuses occupied ports. Stop the owning terminal with Ctrl+C before starting a replacement. Do not terminate unrelated processes or containers.

| Service | Address on MPDEE-SERVER | Private NAS destination |
| --- | --- | --- |
| FFTS app | http://127.0.0.1:4000 | Runs on MPDEE-SERVER |
| Supabase API | http://127.0.0.1:55321 | 172.22.0.6:8000 |
| PostgreSQL | 127.0.0.1:55322, database/user `postgres` | 172.22.0.4:5432 |
| Supabase Studio | http://127.0.0.1:55323 | 172.22.0.3:3000 |
| Auth email catcher (Mailpit) | http://127.0.0.1:55324 | 172.22.0.5:8025 |

These localhost addresses refer to MPDEE-SERVER. No Docker installation is needed there. SSH uses the existing authorized `admin@192.168.0.14` account. The NAS permits local forwards to the four documented container destinations; keep their static addresses aligned with the SSH policy.

`GET /api/development/target` must identify `ffts-development`, API port 55321, PG port 55322 and app port 4000. It exposes no credentials and returns 404 outside validated development configuration. The middleware permits only this exact identity route before authentication. Testsuite preflight checks it before creating clients or authenticating.

## What is running on the NAS

The dedicated Compose project is `ffts-development` under `/home/admin/ffts-development`, on the NAS system disk. Its public configuration is tracked in `infra/nas-development/`; its real `.env` stays private on the NAS. Existing workloads, Docker socket permissions and the separate 1,000 GB camera recording allocation are unchanged.

The official Supabase Docker source is pinned in `infra/nas-development/SOURCE.json`. Ten services provide PostgreSQL 17.6, Auth, REST, Realtime, Storage, image processing, database metadata, Studio, an API gateway and Mailpit. Analytics, a pooler and Edge Functions are unnecessary for this development project. Containers restart with the existing Docker engine and have bounded logs.

Every service belongs exclusively to `ffts-development-internal`, with `internal: true` and no published ports. API, database, Studio and Mailpit use stable private addresses; other service addresses come from a separate dynamic range. The tunnel command checks container ownership, health, network isolation and destinations, then verifies all four forwarded services before reporting readiness. It never changes Docker, SSH policy or another process.

Use the Compose project directly on the NAS for maintenance:

```bash
cd /home/admin/ffts-development
docker compose -p ffts-development -f compose.yaml ps
docker compose -p ffts-development -f compose.yaml up -d --wait
```

To stop only FFTS, use the same project/file arguments with `stop`. Do not prune Docker, remove volumes, reset the database or alter other NAS services as part of ordinary development. Do not run `supabase start` on MPDEE-SERVER. The pinned Supabase CLI is available for migration utilities; this stack is managed by Compose.

## Private environment separation

The local `.env.local` and `.env.development.local` both contain NAS-only settings. Hosted credentials are preserved separately in ignored `.env.ffts-hosted.local`; normal app, fixture and testsuite tooling must never load that backup. Next.js merges environment files, so a hosted fallback in `.env.local` is unsafe even when `.env.development.local` exists.

The development files contain `FFTS_DATA_ENVIRONMENT=development`, the loopback endpoints above, independent NAS JWT/database credentials and independent app-session/cron secrets. API keys identify issuer `supabase-demo`, project `ffts-development` and their intended anon/service roles. PostgreSQL URI/host/port/user/database aliases agree. Database SSL is disabled only after the development target validates.

External email, fleet, vehicle-data and map API credentials are blank in the development files. Supabase Auth messages are captured by Mailpit. Application email uses its existing provider integration and is disabled without that provider key; it is not automatically rerouted to Mailpit. External integrations need deliberately supplied development credentials for integration-specific testing. They must not silently fall back to hosted credentials.

The shared guard rejects hosted, mixed or unrecognized API/PG/app targets, wrong ports/users/databases, conflicting aliases, hosted or unverifiable API-key claims and PostgreSQL connection overrides. Legacy production allowlists or confirmation flags cannot override it. Conflicting inherited shell settings fail closed.

## Database copy and accounts

The 9 November 2026 development snapshot contains 168 public tables, 18 customers, 34 quotes, 43 jobs and all seven retained identities. The clone also has the custom Auth trigger, 17 Storage policies, six buckets and three PDFs. All 378 public foreign keys and the copied file hashes were verified. The permission-hardening migration was applied to both hosted and NAS databases.

Hosted Auth sessions, refresh tokens and MFA state were not copied. Pending Auth tokens were cleared; copied app sessions, PIN unlocks, passkeys and device-pairing state were removed before use. Development subsequently creates its own sessions. The copy is independent: changes do not synchronize back to hosted data, and later hosted changes do not appear automatically. A future refresh is a separate, reviewed operation.

All four retained test identities remain protected in the hosted project: Matt Duffill TEST ACCOUNT, Testsuite Admin, Testsuite Manager and Testsuite Employee. The three NAS testsuite copies have independent development passwords stored only in ignored local state/environment files. Provision or reset those three local identities with:

```powershell
npm run testsuite:setup:development
```

This command validates development configuration first and writes `testsuite/.state/test-users.json`. It does not reset Matt's separate test account or any hosted account.

## Fixtures and checks

```powershell
npm run scheduling:sample:apply -- --confirm-development=FFTS_SCHEDULING_SAMPLE
npm run fleet-inventory:sample:apply -- --confirm-development=FFTS_FLEET_INVENTORY_SAMPLE
npm run testsuite:api
npm run testsuite:ui
```

Fixture plans, inspection and cleanup also require verified development configuration. Existing ownership checks, signed previews, PIN checks and server-derived actors remain enforced. Use each fixture's matching cleanup confirmation and inspect exact owned residue after a failure; never broadly delete records.

Ordinary `tests/` runs do not load `.env.local` or connect real clients/network. Real integration access requires `FFTS_INTEGRATION_TESTS=development` and a matching running app. Some legacy PostgreSQL tests additionally require their own disposable test database; do not bypass those checks.

Credential-free permission/guard checks:

```powershell
node node_modules/vitest/vitest.mjs run --config vitest.launch.config.ts --maxWorkers=1 --no-file-parallelism
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

The launch suite uses isolated setup and in-memory PGlite. It does not load environment files or connect to Supabase. Runtime validation and remaining release work are recorded in [LAUNCH_PHASES_1_2.md](LAUNCH_PHASES_1_2.md). Local commits do not deploy: production application changes still require an explicitly authorized push/release.
