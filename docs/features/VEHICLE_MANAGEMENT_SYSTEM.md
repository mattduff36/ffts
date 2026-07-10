# Fleet Management System

## Overview

Forest Farm Operations manages vans, HGVs, and plant through the `/fleet` module. Each asset type has dedicated history, inspection, maintenance, retirement, and workshop relationships while sharing common permission and reporting patterns.

## Routes

- `/fleet` — fleet overview, maintenance status, categories, and asset management.
- `/fleet/vans/[vanId]/history` — van details, inspections, maintenance, and workshop history.
- `/fleet/hgvs/[hgvId]/history` — HGV details, inspections, maintenance, and workshop history.
- `/fleet/plant/[plantId]/history` — plant details, inspections, maintenance, and workshop history.

## Core Behavior

- Active assets are available to the matching daily-check workflow.
- Registration or asset identifiers are normalized and duplicate-checked.
- Maintenance categories determine due-date, mileage, and hours fields.
- Inspection defects can create linked workshop tasks.
- Assets with open work or dependent records are retired rather than deleted.
- Inventory-backed fleet locations use asset foreign keys as stable identities.

## Permissions

- Fleet and inspection access is controlled through module permission levels.
- Managers and admins can create, edit, retire, and restore assets according to their effective permissions.
- Employees can view and select assets required by enabled daily-check workflows.
- Row Level Security remains the authoritative database boundary.

## Data Model

Primary tables include:

- `vans`, `hgvs`, and `plant`
- `van_categories`, `hgv_categories`, and `plant_categories`
- `vehicle_maintenance`, `maintenance_categories`, and `maintenance_history`
- `van_inspections`, `hgv_inspections`, and `plant_inspections`
- `actions` and workshop task history tables
- `inventory_locations` and `profile_fleet_assignments`

Do not reintroduce the retired generic `vehicles` model in new code.

## External Services

DVLA VES and MOT History integrations are optional. Their actions must remain unavailable or fail clearly when provider credentials are absent. See:

- [`../guides/DVLA_API_SETUP.md`](../guides/DVLA_API_SETUP.md)
- [`../guides/MOT_API_SETUP.md`](../guides/MOT_API_SETUP.md)
- [`../guides/REGISTRATION_STANDARDIZATION.md`](../guides/REGISTRATION_STANDARDIZATION.md)

## Validation

Run unit/integration coverage for the affected asset type, `npm run db:validate` after schema changes, and the targeted fleet UI tests before release.
