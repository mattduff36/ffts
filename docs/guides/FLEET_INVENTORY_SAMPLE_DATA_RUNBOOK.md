# Fleet and Inventory sample-data runbook

This runbook authorizes one guarded production fixture for demonstrating tree-surgery Fleet Plant
and Inventory workflows. It creates only fictional records marked by
`fleet-inventory-sample-v1` and deterministic `ZZ99-` identifiers.

The fixture contains:

- 10 active heavy Fleet Plant assets;
- 8 inactive backing Plant rows for Inventory Minor Plant;
- 10 owned Plant maintenance rows with no registrations or tracker identifiers;
- 12 Inventory Small Tools across Tools, Equipment, and Signs;
- 8 Inventory Minor Plant items, including three chainsaws;
- 8 linked `inventory_minor_plant_details` rows;
- zero active Fleet Plant / Inventory Minor Plant overlap.

It does not create or modify Inventory locations, users, inspections, scheduling assignments,
customers, Quotes, projects, registrations, tracker integrations, or external-service records.

## Preconditions

1. Confirm `.env.local` points to the intended production Supabase project.
2. Set `FLEET_INVENTORY_SAMPLE_PRODUCTION_PROJECT_REF` to that project's exact reference.
3. Take a database backup or confirm point-in-time recovery is available.
4. Confirm the Fleet Plant and Inventory migrations are current.
5. Generate and review the manifest:

   ```bash
   npm run fleet-inventory:sample:plan
   ```

The plan runs its database inspection in a read-only transaction. It refuses:

- a Supabase URL/database/project-ref mismatch;
- an incomplete Fleet or Inventory schema;
- missing active `tools`, `equipment`, `signs`, or `minor_plant` categories;
- anything other than exactly one active `Yard` location;
- deterministic UUID, Plant ID, serial number, Inventory ID, source, or category collisions.

The manifest is written under:

```text
docs_private/automation/runs/fleet-inventory-sample/
```

## Plant category handling

The fixture does not broadly rewrite Fleet categories.

1. If one exact `All plant` category already applies to Plant, it is reused without mutation.
2. If one exact, unused legacy row has:
   - name `All plant`;
   - description `All plant machinery and equipment`;
   - `applies_to = ['van']`;

   the apply transaction temporarily adds `plant` and marks the description with the fixture key.
   Cleanup restores the exact original values only when no unrelated Plant uses the category.
3. Any ambiguous or non-exact state uses a deterministic `SAMPLE Tree Surgery Plant` category owned
   by the fixture. Cleanup deletes it only when its identity, description, applicability, and lack
   of unrelated use all match.

## Apply

Before applying, report:

- project reference;
- fixture key and generated manifest path;
- category strategy and category ID;
- all manifest counts;
- `ZZ99-FP-*`, `ZZ99-MP-*`, and `ZZ99-TL-*` identifier ranges;
- zero registrations, tracker identifiers, and active overlap;
- exact cleanup command.

Run only after the operator explicitly approves:

```bash
npm run fleet-inventory:sample:apply -- --confirm-production=FFTS_FLEET_INVENTORY_SAMPLE
```

Apply runs collision checks and all writes in one transaction. It verifies every expected count,
the active/inactive split, linked Minor Plant details, zero active overlap, and absence of
registrations and tracker IDs before commit, then repeats count verification after commit.

## Verify

1. Open `/fleet?tab=plant` and confirm 10 active `ZZ99-FP-*` assets.
2. Confirm no chainsaws appear in active Fleet Plant.
3. Open `/inventory` and confirm 12 Small Tools.
4. Open `/inventory?overview=minor-plant` and confirm 8 Minor Plant items, including three
   chainsaws.
5. Open several Minor Plant details and confirm Plant ID, make, model, and serial data.
6. Confirm the Scheduling fixture locations and all unrelated Inventory locations are unchanged.

## Cleanup

Preview owned counts and dependency checks:

```bash
npm run fleet-inventory:sample:cleanup -- --dry-run
```

Remove only after operator approval:

```bash
npm run fleet-inventory:sample:cleanup -- --confirm-production=FFTS_FLEET_INVENTORY_SAMPLE
```

Cleanup aborts if:

- any owned Plant, maintenance, Inventory, or Minor Plant detail row is missing or its ownership,
  identity, status, category, location, source, registration, tracker, or updater state changed;
- any sample Plant acquired actions, custom maintenance values, DVLA logs, linked Inventory
  locations, maintenance history, Plant/van inspections, fleet assignments, reminders, scheduling
  assignments, or unavailability;
- any sample Inventory item acquired checks, group membership, or movement history;
- the temporarily patched category is used by unrelated Plant;
- the dedicated category no longer matches its exact ownership marker.

The backing Plant rows are deleted only after the Inventory rows that reference them. Existing
Scheduling sample locations and unrelated records are never selected by cleanup predicates.

## Recovery

- Apply failures before commit roll back every fixture and category write.
- Never manually broaden cleanup predicates or delete by `SAMPLE` name alone.
- If post-commit verification fails, do not rerun apply. Run cleanup dry-run, investigate the exact
  owned rows, and use the printed cleanup command only when all ownership checks pass.
- Restore from backup if ownership is uncertain.
