# NAS Supabase development stack

Public configuration for the existing FFTS-only stack at `/home/admin/ffts-development` on `LBP-HO-L3A2` (`192.168.0.14`). Docker runs on the NAS; the app runs on MPDEE-SERVER. Daily commands, private environment handling and validation are in [LOCAL_DEVELOPMENT.md](../../docs/guides/LOCAL_DEVELOPMENT.md).

## Contents and provenance

- `compose.yaml`: pinned official Supabase services, scoped container/project names, private networking and Mailpit.
- `SOURCE.json`: exact upstream source revision and component versions used during setup.
- `LICENSE.supabase`: the upstream Apache 2.0 license for the copied configuration/support files.
- `volumes/api/envoy/`: upstream gateway templates and entrypoint.
- `volumes/db/`: upstream initialization SQL for the self-hosted platform roles/services.
- `.env.example`: variable names and nonsecret defaults only. Placeholder values must be replaced with independent private development secrets before a new installation.

The existing NAS `.env` is already configured. Do not overwrite it with the example or regenerate secrets on an existing database without a coordinated rotation. Database files and Storage files live in the NAS `volumes/` subdirectories; the `db-config` named volume belongs only to this Compose project. Neither data nor real secrets are tracked here.

## Network contract

No service publishes a host port, uses host networking, mounts the Docker socket or runs privileged. The sole network is internal, subnet `172.22.0.0/16`, gateway `172.22.0.1`, dynamic range `172.22.128.0/17`.

| Container | Static IP | Container port | MPDEE-SERVER loopback port |
| --- | --- | --- | --- |
| `ffts-api-gw` | 172.22.0.6 | 8000 | 55321 |
| `ffts-db` | 172.22.0.4 | 5432 | 55322 |
| `ffts-studio` | 172.22.0.3 | 3000 | 55323 |
| `ffts-mailpit` | 172.22.0.5 | 8025 | 55324 |

`npm run dev:nas:tunnel` validates this contract and opens the four forwards using the authorized NAS SSH account. The NAS SSH configuration must allow local forwarding for that account to these destinations. Its global administration remains outside this project. Avoid changing addresses or adding host port publishing to work around an SSH-policy failure.

## Scope and recovery

Use `docker compose -p ffts-development -f compose.yaml ...` from the dedicated NAS directory. For the optional NAS CLI at `bin/supabase`, set `SUPABASE_HOME=/home/admin/ffts-development/cli-home`; the parent `/home/admin` directory is intentionally not writable by admin. Ordinary start/stop/recreation preserves the database and Storage volumes. A database reset or removal of volumes destroys development work and requires a separately reviewed refresh/restore procedure. Never apply a general Docker cleanup to the NAS.

The initial clone used a Supabase CLI-filtered schema/public-data dump, imported Auth users/identities with generated columns omitted and active tokens removed, restored the custom Auth trigger and Storage policies, and uploaded actual objects through Storage. Existing platform roles/passwords were retained. Private backup inputs and receipts are outside Git. Do not replay all historical migrations over an already-restored database or substitute raw managed-platform internals for the supported self-hosted schema.

Keep the project and backup directories at mode `700`, and the real `.env` and private archives at `600`. Recheck these modes after extracting an archive, because archive directory metadata can replace them.

The camera allocation under `/srv/mpdee-cctv`, original containers and Docker socket permissions are outside this stack and must remain unchanged.
