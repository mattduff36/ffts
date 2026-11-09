# Pre-launch data protection

Sample cleanup is complete. The hosted Forest Farm target is **protected client data**, even while the app remains pre-launch and some existing business records originated as test work. Incoming real data must never be treated as disposable.

Seven identities were retained. Four explicitly protected test identities are Matt Duffill TEST ACCOUNT, Testsuite Admin, Testsuite Manager and Testsuite Employee. Their presence is not authorization to delete, disable, reset, seed or run automated workflows against hosted accounts.

## Fixtures and tests

All managed scheduling/fleet fixtures, CLI plans and cleanup, test-user provisioning and automated suites require the explicit verified development target. Production confirmation flags and old sample-project allowlists cannot override it. Hosted Debug sample tools report unavailable without inspecting hosted rows. Existing production fixture runbook examples are superseded by [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md).

The dedicated NAS `ffts-development` project and SSH forwards are operational and have passed runtime checks. The hosted permission migration and development copy are recorded in [LAUNCH_PHASES_1_2.md](LAUNCH_PHASES_1_2.md). Keep future migration and infrastructure operations explicitly scoped; isolated checks alone never establish live readiness.

## Risk and migration safety

The blanket SAMPLE DATA lane exemption is retired for hosted work. Apply proportionate safeguards to the actual persistence, authorization, money, concurrency and production-data risks; use CRITICAL when the applicable workflow requires it. Isolated development work can still use FAST, STANDARD or GUARDED as appropriate. See `.cursor/rules/sample-data-phase.mdc`.

Use approved `pg` migrations, do not expose secrets, run `npm run db:validate` after rename/drop, and obtain explicit authorization before destructive schema/data changes. Workers do not apply hosted migrations; the parent owns inventory, approval, application and live verification.

## Related

- [SCHEDULING_SAMPLE_DATA_RUNBOOK.md](SCHEDULING_SAMPLE_DATA_RUNBOOK.md)
- [FLEET_INVENTORY_SAMPLE_DATA_RUNBOOK.md](FLEET_INVENTORY_SAMPLE_DATA_RUNBOOK.md)
- [HOW_TO_RUN_MIGRATIONS.md](HOW_TO_RUN_MIGRATIONS.md)
