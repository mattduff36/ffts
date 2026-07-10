# FFTS Handoff Package Contents

Copy the contents of this `ffts/` folder into the root of the cloned `mattduff36/ffts` project.

This package is local handoff material only. It is not a replacement for cloning the actual repo.

## Files

| File | Copy To | Purpose |
| --- | --- | --- |
| `README-SETUP-FFTS.md` | Project root | Main instruction file for the new project chat and future developers. Read this first. |
| `.env.forest.example` | Project root | Production env template. Copy or rename to `.env.local`, then fill in real Forest Farm values. |
| `FOREST_FARM_PRODUCTION_SETUP.md` | Project root, or `docs/guides/FOREST_FARM_PRODUCTION_SETUP.md` | Operational production setup guide for env, DB bootstrap, first login, and verification commands. |
| `PACKAGE_CONTENTS.md` | Project root, optional | This manifest. Keep if useful, delete after setup if not needed. |

## Recommended Copy Layout

After copying into the `ffts` project root, the target repo can look like this:

```text
ffts/
  README-SETUP-FFTS.md
  FOREST_FARM_PRODUCTION_SETUP.md
  PACKAGE_CONTENTS.md
  .env.forest.example
  app/
  components/
  lib/
  scripts/
  supabase/
  package.json
```

If you prefer to keep setup docs under `docs/guides/`, move:

```text
FOREST_FARM_PRODUCTION_SETUP.md -> docs/guides/FOREST_FARM_PRODUCTION_SETUP.md
```

## First Prompt For The New Project Chat

```text
Examine and understand README-SETUP-FFTS.md and FOREST_FARM_PRODUCTION_SETUP.md. Use them to verify this codebase is ready for local development. Do not run database bootstrap, seed, reset, wipe, or deploy commands until I explicitly approve them.
```

## Safety Notes

- Do not commit `.env.local`.
- Do not set `NODE_ENV` in Vercel.
- Do not set demo variables in production.
- Do not run demo scripts against the Forest Farm production Supabase project.
- Run `npm run forest:bootstrap-production` only after `.env.local` points at the new dedicated Forest Farm Supabase project.
- Remove `FOREST_FARM_SUPERADMIN_PASSWORD` from `.env.local` after the first SuperAdmin login has been verified.

## Source Commit

The productionised FFTS repo should start from commit `4ad6360a` or newer on:

```text
https://github.com/mattduff36/ffts
```
