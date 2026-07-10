# Forest Farm Operations Documentation

This directory contains the public developer, feature, setup, and verification documentation for the FFTS production application. It intentionally excludes customer records, generated screenshots, live-data audits, private automation output, and one-off production incident reports.

## Start Here

- [`../README.md`](../README.md) — product overview and local commands.
- [`../README-SETUP-FFTS.md`](../README-SETUP-FFTS.md) — complete Forest Farm setup and handover instructions.
- [`../FOREST_FARM_PRODUCTION_SETUP.md`](../FOREST_FARM_PRODUCTION_SETUP.md) — production bootstrap checklist.
- [`DEVELOPMENT_STANDARDS_AND_TEMPLATES.md`](DEVELOPMENT_STANDARDS_AND_TEMPLATES.md) — implementation standards and code patterns.

## Database and Operations

- [`guides/HOW_TO_RUN_MIGRATIONS.md`](guides/HOW_TO_RUN_MIGRATIONS.md)
- [`guides/MIGRATIONS_GUIDE.md`](guides/MIGRATIONS_GUIDE.md)
- [`guides/AUDIT_LOGGING.md`](guides/AUDIT_LOGGING.md)
- [`guides/ERROR_LOGGING.md`](guides/ERROR_LOGGING.md)
- [`guides/RESEND_SETUP_GUIDE.md`](guides/RESEND_SETUP_GUIDE.md)
- [`guides/AUTH_TROUBLESHOOTING.md`](guides/AUTH_TROUBLESHOOTING.md)
- [`guides/USER_ROLE_CHANGE_PROCEDURE.md`](guides/USER_ROLE_CHANGE_PROCEDURE.md)
- [`guides/ABSENCE_ARCHIVE_RUNBOOK.md`](guides/ABSENCE_ARCHIVE_RUNBOOK.md)
- [`guides/MESSAGES_MIGRATION_GUIDE.md`](guides/MESSAGES_MIGRATION_GUIDE.md)
- [`guides/TESTING_ERROR_LOGGING.md`](guides/TESTING_ERROR_LOGGING.md)

## Product Domains

- [`PRD_WORKSHOP_TASKS.md`](PRD_WORKSHOP_TASKS.md) and [`guides/WORKSHOP_TASKS_IMPLEMENTATION.md`](guides/WORKSHOP_TASKS_IMPLEMENTATION.md)
- [`guides/INVENTORY_LOCATIONS.md`](guides/INVENTORY_LOCATIONS.md)
- [`features/RAMS_FEATURE_PRD.md`](features/RAMS_FEATURE_PRD.md) and [`features/RAMS_IMPLEMENTATION_PROGRESS.md`](features/RAMS_IMPLEMENTATION_PROGRESS.md)
- [`features/VEHICLE_MANAGEMENT_SYSTEM.md`](features/VEHICLE_MANAGEMENT_SYSTEM.md)
- [`features/PASSWORD_MANAGEMENT_IMPLEMENTATION.md`](features/PASSWORD_MANAGEMENT_IMPLEMENTATION.md)
- [`features/ERROR_REPORTING_SYSTEM.md`](features/ERROR_REPORTING_SYSTEM.md)
- [`features/DAILY_ERROR_EMAIL_SUMMARY.md`](features/DAILY_ERROR_EMAIL_SUMMARY.md)
- [`features/REPORTS_IMPLEMENTATION_SUMMARY.md`](features/REPORTS_IMPLEMENTATION_SUMMARY.md)
- [`guides/REPORTS_QUICK_START.md`](guides/REPORTS_QUICK_START.md)
- [`features/BANK_HOLIDAY_WARNING_FEATURE.md`](features/BANK_HOLIDAY_WARNING_FEATURE.md)
- [`features/PAYROLL_AUTOMATIC_DETECTION.md`](features/PAYROLL_AUTOMATIC_DETECTION.md)
- [`features/PAYROLL_API_INTEGRATION.md`](features/PAYROLL_API_INTEGRATION.md)
- [`features/DVLA_API_INTEGRATION.md`](features/DVLA_API_INTEGRATION.md)
- [`implementation/plant-maintenance-categories.md`](implementation/plant-maintenance-categories.md)
- [`features/PAYROLL_UPDATE_SUMMARY.md`](features/PAYROLL_UPDATE_SUMMARY.md)
- [`features/REPORTS_UI_CLEANUP.md`](features/REPORTS_UI_CLEANUP.md)

## External Integrations

- [`guides/DVLA_API_SETUP.md`](guides/DVLA_API_SETUP.md)
- [`guides/DVLA_VES_CRON_SETUP.md`](guides/DVLA_VES_CRON_SETUP.md)
- [`guides/MOT_API_SETUP.md`](guides/MOT_API_SETUP.md)
- [`guides/REGISTRATION_STANDARDIZATION.md`](guides/REGISTRATION_STANDARDIZATION.md)
- [`guides/MOT_API_PENDING.md`](guides/MOT_API_PENDING.md)
- [`guides/VES_API_PENDING.md`](guides/VES_API_PENDING.md)

## Verification

- [`testing/inspections-verification.md`](testing/inspections-verification.md)
- [`../tests/README.md`](../tests/README.md)
- [`../testsuite/README.md`](../testsuite/README.md)
- [`../scripts/testing/TESTING_SAFETY_RULES.md`](../scripts/testing/TESTING_SAFETY_RULES.md)
- Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run db:validate`, and a clean `npm run build` before release.

Documentation must use Forest Farm terminology and fictional examples. Never add live customer, employee, fleet, credential, or private deployment data.
