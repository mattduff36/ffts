# Inventory Location Contract

Inventory locations are the canonical place model for the inventory module. Every active inventory item belongs to exactly one active `inventory_locations` row, and all movement history is recorded against those location ids.

This contract defines the post-migration location model used by Forest Farm Operations.

## Canonical Table

`inventory_locations` remains the only location table for inventory. Asset-backed and site-backed locations are subtypes of that table, not separate models.

Location identity is type and source based:

- `location_type = 'yard'`: the shared Yard location. Workshop users may share it as their primary inventory location.
- `location_type = 'unknown'`: the Unknown holding location. Items here are exempt from scheduled inventory checks until assigned elsewhere.
- `location_type = 'van'`: a fleet van inventory location, linked by `linked_van_id`.
- `location_type = 'hgv'`: a fleet HGV inventory location, linked by `linked_hgv_id`.
- `location_type = 'plant'`: a fleet plant inventory location, linked by `linked_plant_id`.
- `location_type = 'site'`: a quote or project-number site location, keyed by `external_reference`.
- `location_type = 'manual'`: a manager-created location that is not generated from a fleet or quote source.

`name` and `description` are display metadata. Business rules should not infer location meaning from names once `location_type` has been backfilled. During rollout, code may keep name-based Yard and Unknown fallbacks for compatibility.

## Source Metadata

Generated locations should store source metadata:

- Fleet-backed locations keep the existing linked asset FK columns as the canonical sync key.
- Quote site locations use `source_type = 'quote'` and `external_reference = quotes.base_quote_reference`.
- Project-number locations use `source_type = 'project_number'` and `external_reference = quote_project_numbers.project_reference`.
- `source_id` may store the current source row id, but it is not the stable display identity because quote revisions can change.

Site addresses are display and search metadata only. They must not be used as a stable location identity.

## Sync Invariants

Every active van returned by the inventory fleet-assets API must have exactly one active `inventory_locations` row with `location_type = 'van'` and `linked_van_id` set.

Site locations are created or kept active for:

- open project numbers;
- quotes that have reached operational status, beginning at PO received or in progress.

Site locations are archived when their quote is closed or lost, or when their project number is cancelled. They are reactivated if the source is reopened.

Generated van and site locations are maintained by sync services. Normal manager UI may edit display metadata where allowed, but should not casually relink generated locations to different source records.

## User Location And Fleet Assignment

`inventory_user_locations` stores a user's selected inventory location. The UI should ask the user to set a location only when the saved location is missing, inactive, or invalid.

When the selected location is linked to a fleet asset, the app also records a current profile fleet assignment. Only one current user may be assigned to a fleet asset at a time. Moving a user to Yard, Unknown, manual, or site locations ends their current fleet assignment.

The inventory location selection remains the source event for this assignment; profile fleet assignment history is used by admin/profile views and future tracking features.

## Movement Rules

All item location changes must go through the canonical move logic so that movement batches, movement history, and check-blocking rules remain consistent.

The canonical rules are:

- moving an item out of Yard is blocked when the item has never been checked or is overdue;
- moving an overdue non-Yard item is blocked unless the destination is Yard;
- Unknown is check-exempt;
- same-location moves should be rejected without creating movement history.

Routes that update `inventory_items.location_id` directly must delegate to the same move logic or reject direct location edits.
