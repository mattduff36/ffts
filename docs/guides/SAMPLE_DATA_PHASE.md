# Sample-data phase

The connected Forest Farm database currently holds **only SAMPLE DATA**. There are no real customer records in use. The application codebase is the production product, but the app has not gone truly live.

Guarded fixtures (scheduling `scheduling-sample-v1`, fleet/inventory `fleet-inventory-sample-v1`, and other owned SAMPLE rows) and any other records created during development are still sample data.

## TEE lane

While this phase holds, **do not use the CRITICAL lane** when planning or implementing new work. Classify FAST, STANDARD, or GUARDED from coordination and uncertainty only.

Generic TEE still treats persistence, schema, migrations, auth, money, concurrency, and production-data risk as CRITICAL categories. FFTS overrides that until go-live. See `.cursor/rules/sample-data-phase.mdc`.

Keep ordinary safety: approved `pg` migrations, no secret exposure, `npm run db:validate` after rename/drop, and explicit authorization before destructive schema or data changes.

## Trigger to resume CRITICAL

Start using the CRITICAL lane again **where necessary** when both of the following are true:

1. All SAMPLE data has been removed.
2. Real customer data is being used (the app is truly live).

That removal is the obvious go-live signal. Until then, do not plan new tasks as CRITICAL merely because they touch the database.

## Related

- [SCHEDULING_SAMPLE_DATA_RUNBOOK.md](SCHEDULING_SAMPLE_DATA_RUNBOOK.md)
- [FLEET_INVENTORY_SAMPLE_DATA_RUNBOOK.md](FLEET_INVENTORY_SAMPLE_DATA_RUNBOOK.md)
- [HOW_TO_RUN_MIGRATIONS.md](HOW_TO_RUN_MIGRATIONS.md)
