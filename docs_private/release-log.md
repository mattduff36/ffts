# Production release log

Private changelog for production builds. Newest entries first.

## 0926.5.0

**GIT COMMIT MESSAGE**
`feat(scheduling): persist standing team leaders and expand daily buckets`

**PUSHED AT**
2026-09-04T16:34:13.564Z

**WHAT CHANGED**
Reject standing leaders that would overflow a full daily slot. Persist standing team leaders and expand daily buckets.

**VERSION HISTORY DETAILS**
- Updated data storage, with changes to automation scripts and data storage.
- Updated help and FAQ, with changes to documentation.

**COMMITS IN THIS RELEASE**
- `fix(scheduling): reject standing leaders that would overflow a full daily slot`
- `feat(scheduling): persist standing team leaders and expand daily buckets`

# Production release log

Private changelog for production builds. Newest entries first.

## 0926.4.1

**GIT COMMIT MESSAGE**
`fix(workflow): prove leftover required IDs after the canonical suite`

**PUSHED AT**
2026-09-04T15:20:03.779Z

**WHAT CHANGED**
Prove leftover required IDs after the canonical suite.

**VERSION HISTORY DETAILS**
- Updated app reliability, with changes to automated tests.

**COMMITS IN THIS RELEASE**
- `fix(workflow): prove leftover required IDs after the canonical suite`

# Production release log

Private changelog for production builds. Newest entries first.

## 0926.4.0

**GIT COMMIT MESSAGE**
`feat(workflow): show hierarchical progress for every verification stage`

**PUSHED AT**
2026-09-04T13:22:56.090Z

**WHAT CHANGED**
Drop unused progress weight local. Keep optional test-progress names assignable. Show hierarchical progress for every verification stage.

**VERSION HISTORY DETAILS**
- Updated reports, with changes to automation scripts.

**COMMITS IN THIS RELEASE**
- `fix(workflow): drop unused progress weight local`
- `fix(workflow): keep optional test-progress names assignable`
- `feat(workflow): show hierarchical progress for every verification stage`

# Production release log

Private changelog for production builds. Newest entries first.

## 0926.3.2

**GIT COMMIT MESSAGE**
`fix(workflow): allow intended Scheduling product candidates through SCOPE-001`

**PUSHED AT**
2026-09-04T12:59:21.056Z

**WHAT CHANGED**
Allow intended Scheduling product candidates through SCOPE-001.

**VERSION HISTORY DETAILS**
- Updated app reliability, with changes to automated tests.

**COMMITS IN THIS RELEASE**
- `fix(workflow): allow intended Scheduling product candidates through SCOPE-001`

# Production release log

Private changelog for production builds. Newest entries first.

## 0926.3.1

**GIT COMMIT MESSAGE**
`fix(scheduling): restore viewport-height fill for the manager board`

**PUSHED AT**
2026-09-04T12:44:51.117Z

**WHAT CHANGED**
Measure SCOPE-001 against origin/main. Allow ordinary finalise to finish without CRITICAL C9. Restore viewport-height fill for the manager board.

**VERSION HISTORY DETAILS**
- Updated sign in, with changes to automated tests.

**COMMITS IN THIS RELEASE**
- `test(workflow): measure SCOPE-001 against origin/main`
- `fix(workflow): allow ordinary finalise to finish without CRITICAL C9`
- `fix(scheduling): restore viewport-height fill for the manager board`

# Production release log

Private changelog for production builds. Newest entries first.

## 0926.3.0

**GIT COMMIT MESSAGE**
`feat(scheduling): fit the manager board to the desktop viewport`

**PUSHED AT**
2026-09-03T23:46:07.210Z

**WHAT CHANGED**
Fit the manager board to the desktop viewport.

**VERSION HISTORY DETAILS**
- Updated app screens, with changes to app screens.

**COMMITS IN THIS RELEASE**
- `feat(scheduling): fit the manager board to the desktop viewport`

# Production release log

Private changelog for production builds. Newest entries first.

## 0926.2.2

**GIT COMMIT MESSAGE**
`fix(workflow): authorise finalise from the latest legal review only`

**PUSHED AT**
2026-09-03T23:26:11.313Z

**WHAT CHANGED**
Treat sourceWorkstreamIds as audit provenance. Reject mismatched review tokens as current authority. Treat inherited exhaustion as no current review authority. Stop leaking FDR-002 through the describe title. Keep required latest-legal IDs on one assertion each. Authorise finalise from the latest legal review only.

**VERSION HISTORY DETAILS**
- Updated sign in, with changes to automated tests.
- Updated help and FAQ, with changes to automated tests.

**COMMITS IN THIS RELEASE**
- `fix(workflow): treat sourceWorkstreamIds as audit provenance`
- `fix(workflow): reject mismatched review tokens as current authority`
- `fix(workflow): treat inherited exhaustion as no current review authority`
- `test(workflow): stop leaking FDR-002 through the describe title`
- `test(workflow): keep required latest-legal IDs on one assertion each`
- `fix(workflow): authorise finalise from the latest legal review only`

# Production release log

Private changelog for production builds. Newest entries first.

## 0926.2.1

**GIT COMMIT MESSAGE**
`fix(scheduling): return visits to Jobs without a confirmation dialog`

**PUSHED AT**
2026-09-02T13:40:31.459Z

**WHAT CHANGED**
Treat fap and ffap as authorized finalise push aliases. Return visits to Jobs without a confirmation dialog.

**VERSION HISTORY DETAILS**
- Updated help and FAQ, with changes to documentation.

**COMMITS IN THIS RELEASE**
- `fix(workflow): treat fap and ffap as authorized finalise push aliases`
- `fix(scheduling): return visits to Jobs without a confirmation dialog`

## 0926.2.0

**GIT COMMIT MESSAGE**
`feat(components): update app screens`

**PUSHED AT**
2026-09-02T12:47:42.888Z

**WHAT CHANGED**
Update app screens.

**VERSION HISTORY DETAILS**
- Updated app screens, with changes to app screens.

**COMMITS IN THIS RELEASE**
- `feat(components): update app screens`

# Production release log

Private changelog for production builds. Newest entries first.

## 0926.1.2

**GIT COMMIT MESSAGE**
`fix(scheduling): coordinate dependent visit commands without full-week refetch`

**PUSHED AT**
2026-09-02T11:32:20.168Z

**WHAT CHANGED**
Keep visit dependencies from self-deadlock and uncertain release. Coordinate dependent visit commands without full-week refetch.

**VERSION HISTORY DETAILS**
- Updated app screens, with changes to app screens.

**COMMITS IN THIS RELEASE**
- `fix(scheduling): keep visit dependencies from self-deadlock and uncertain release`
- `fix(scheduling): coordinate dependent visit commands without full-week refetch`

## 0926.1.1

**GIT COMMIT MESSAGE**
`fix(scheduling): persist Schedule Board job order independently of created_at`

**PUSHED AT**
2026-09-02T00:37:51.564Z

**WHAT CHANGED**
Persist Schedule Board job order independently of created_at.

**VERSION HISTORY DETAILS**
- Updated data storage, with changes to shared typing, automation scripts, automated tests, and data storage.

**COMMITS IN THIS RELEASE**
- `fix(scheduling): persist Schedule Board job order independently of created_at`

## 0926.1.0

**GIT COMMIT MESSAGE**
`feat(components): update App screens and Background services`

**PUSHED AT**
2026-09-01T23:38:16.922Z

**WHAT CHANGED**
Update App screens and Background services. Stabilise rapid visit interactions. Coordinate assignment mutations without silent drops.

**VERSION HISTORY DETAILS**
- Updated data storage, with changes to automated tests and data storage.
- Updated help and FAQ, with changes to documentation.

**COMMITS IN THIS RELEASE**
- `feat(components): update App screens and Background services`
- `fix(scheduling): stabilise rapid visit interactions`
- `feat(scheduling): coordinate assignment mutations without silent drops`

## 0926.0.0

**GIT COMMIT MESSAGE**
`feat(scheduling): extend board hour lines through empty space`

**PUSHED AT**
2026-09-01T20:00:08.885Z

**WHAT CHANGED**
Update app reliability. Ignore local planning packs so finalise cannot add them. Bind review tokens to HEAD and keep delta retries live. Make split CRITICAL lineages finalisable. Extend board hour lines through empty space. Fill Resources and the schedule board to the viewport. Show daily employee occupancy on resource cards. Add shared daily team buckets for visit assignment. Group the board by job, employee, or plant.

**VERSION HISTORY DETAILS**
- Updated data storage, with changes to automation scripts, automated tests, and data storage.
- Updated help and FAQ, with changes to documentation.

**COMMITS IN THIS RELEASE**
- `test(tests): update app reliability`
- `chore: ignore local planning packs so finalise cannot add them`
- `fix(workflow): bind review tokens to HEAD and keep delta retries live`
- `fix(workflow): make split CRITICAL lineages finalisable`
- `feat(scheduling): extend board hour lines through empty space`
- `feat(scheduling): fill Resources and the schedule board to the viewport`
- `feat(scheduling): show daily employee occupancy on resource cards`
- `feat(scheduling): add shared daily team buckets for visit assignment`
- `feat(scheduling): group the board by job, employee, or plant`

## 0826.12.0

**GIT COMMIT MESSAGE**
`feat(quotes): update Quotes, Customers, and Projects`

**PUSHED AT**
2026-08-24T10:05:54.505Z

**WHAT CHANGED**
Update Quotes, Customers, and Projects.

**VERSION HISTORY DETAILS**
- Updated navigation, with changes to interface components and automated tests.
- Updated Quotes, Customers, and Projects, with changes to app screens and automated tests.
- Updated customers, with changes to app screens and automated tests.
- Updated projects, with changes to app screens.

**COMMITS IN THIS RELEASE**
- `feat(quotes): update Quotes, Customers, and Projects`

## 0826.11.0

**GIT COMMIT MESSAGE**
`feat(quotes): update Quotes, Actions, and Help and FAQ`

**PUSHED AT**
2026-08-24T09:52:36.603Z

**WHAT CHANGED**
Update Quotes, Actions, and Help and FAQ.

**VERSION HISTORY DETAILS**
- Updated Quotes, Actions, and Help and FAQ, with changes to background routes, app screens, automated tests, and documentation.
- Updated actions, with changes to app screens and automated tests.
- Updated help and FAQ, with changes to documentation.

**COMMITS IN THIS RELEASE**
- `feat(quotes): update Quotes, Actions, and Help and FAQ`

## 0826.10.0

**GIT COMMIT MESSAGE**
`feat(quotes): update quotes`

**PUSHED AT**
2026-08-24T09:33:49.085Z

**WHAT CHANGED**
Update quotes.

**VERSION HISTORY DETAILS**
- Updated quotes, with changes to background routes, app screens, and automated tests.

**COMMITS IN THIS RELEASE**
- `feat(quotes): update quotes`

## 0826.9.0

**GIT COMMIT MESSAGE**
`feat(quotes): add admin toggle to disable customer quote emails`

**PUSHED AT**
2026-08-24T09:27:49.058Z

**WHAT CHANGED**
Update repository files. Keep dirty quote and similar dialogs until save or discard. Make Enter move to the next form field. Keep quote timeline honest when customer emails are disabled. Add admin toggle to disable customer quote emails.

**VERSION HISTORY DETAILS**
- Keep dirty quote and similar dialogs until save or discard, with changes to background routes, app screens, shared logic, automation scripts, automated tests, and data storage.
- Updated customers, with changes to app screens, automation scripts, automated tests, and data storage.
- Updated data storage, with changes to shared typing, automation scripts, and data storage.
- Updated inventory, with changes to app screens and automated tests.
- Updated projects, with changes to app screens.

**COMMITS IN THIS RELEASE**
- `chore(repo): update repository files`
- `fix(quotes): keep dirty quote and similar dialogs until save or discard`
- `fix(quotes): make Enter move to the next form field`
- `fix(quotes): keep quote timeline honest when customer emails are disabled`
- `feat(quotes): add admin toggle to disable customer quote emails`

## 0826.8.0

**GIT COMMIT MESSAGE**
`feat(quotes): update quotes`

**PUSHED AT**
2026-08-24T08:56:59.848Z

**WHAT CHANGED**
Update quotes.

**VERSION HISTORY DETAILS**
- Updated quotes, with changes to app screens and automated tests.
- Updated customers, with changes to app screens and automated tests.

**COMMITS IN THIS RELEASE**
- `feat(quotes): update quotes`

## 0826.7.0

**GIT COMMIT MESSAGE**
`feat(daily-tasks): update daily tasks`

**PUSHED AT**
2026-08-11T23:05:04.073Z

**WHAT CHANGED**
Update daily tasks. Close WS1/WS2 premium review blockers. Record WS3 fixerrors closure review pass. Add trusted exact-snapshot fixerrors cleanup. Integrate TEE checkpoints and finalise repair. Align protocol split test input. Add repository-enforced TEE V2.2 core workflow.

**VERSION HISTORY DETAILS**
- Updated actions, with changes to automation scripts and automated tests.
- Updated help and FAQ, with changes to documentation.
- Updated daily tasks, with changes to automated tests.
- Updated data storage, with changes to data storage.

**COMMITS IN THIS RELEASE**
- `feat(daily-tasks): update daily tasks`
- `fix(automation): close WS1/WS2 premium review blockers`
- `docs(automation): record WS3 fixerrors closure review pass`
- `feat(automation): add trusted exact-snapshot fixerrors cleanup`
- `feat(automation): integrate TEE checkpoints and finalise repair`
- `fix(automation): align protocol split test input`
- `feat(automation): add repository-enforced TEE V2.2 core workflow`

## 0826.6.0

**GIT COMMIT MESSAGE**
`feat(quotes): update Quotes, Projects, and Help and FAQ`

**PUSHED AT**
2026-08-11T14:16:58.269Z

**WHAT CHANGED**
Update Quotes, Projects, and Help and FAQ.

**VERSION HISTORY DETAILS**
- Updated Quotes, Projects, and Help and FAQ, with changes to background routes, app screens, and automated tests.
- Updated projects, with changes to app screens.
- Updated help and FAQ, with changes to documentation.

**COMMITS IN THIS RELEASE**
- `feat(quotes): update Quotes, Projects, and Help and FAQ`

## 0826.5.0

**GIT COMMIT MESSAGE**
`feat(components): update app screens`

**PUSHED AT**
2026-08-11T10:21:09.955Z

**WHAT CHANGED**
Update app screens.

**VERSION HISTORY DETAILS**
- Updated app screens, with changes to app screens.

**COMMITS IN THIS RELEASE**
- `feat(components): update app screens`

## 0826.4.0

**GIT COMMIT MESSAGE**
`feat(components): update app screens`

**PUSHED AT**
2026-08-11T09:13:30.717Z

**WHAT CHANGED**
Update app screens.

**VERSION HISTORY DETAILS**
- Updated app screens, with changes to app screens.

**COMMITS IN THIS RELEASE**
- `feat(components): update app screens`

## 0826.3.1

**GIT COMMIT MESSAGE**
`chore(db): update Data storage and Help and FAQ`

**PUSHED AT**
2026-08-11T00:45:00.841Z

**WHAT CHANGED**
Update Data storage and Help and FAQ.

**VERSION HISTORY DETAILS**
- Updated Data storage and Help and FAQ, with changes to automated tests and data storage.
- Updated help and FAQ, with changes to documentation.

**COMMITS IN THIS RELEASE**
- `chore(db): update Data storage and Help and FAQ`

## 0826.3.0

**GIT COMMIT MESSAGE**
`feat(scheduling): add Schedule Board Quick add and touch-first assignment`

**PUSHED AT**
2026-08-10T22:10:32.428Z

**WHAT CHANGED**
Stabilize scheduling handle and van daily-check E2E. Start wide-board E2E drag from resource handle. Add Schedule Board Quick add and touch-first assignment.

**VERSION HISTORY DETAILS**
- Updated data storage, with changes to shared typing, automated tests, and data storage.
- Updated help and FAQ, with changes to documentation.
- Updated projects, with changes to automated tests.
- Updated daily tasks, with changes to automated tests.

**COMMITS IN THIS RELEASE**
- `fix(testsuite): stabilize scheduling handle and van daily-check E2E`
- `fix(scheduling): start wide-board E2E drag from resource handle`
- `feat(scheduling): add Schedule Board Quick add and touch-first assignment`

## 0826.2.0

**GIT COMMIT MESSAGE**
`feat(components): update app screens`

**PUSHED AT**
2026-08-06T23:21:58.821Z

**WHAT CHANGED**
Update app screens.

**VERSION HISTORY DETAILS**
- Updated app screens, with changes to app screens.

**COMMITS IN THIS RELEASE**
- `feat(components): update app screens`

## 0826.1.0

**GIT COMMIT MESSAGE**
`feat(components): update app screens`

**PUSHED AT**
2026-08-06T21:49:03.159Z

**WHAT CHANGED**
Update app screens.

**VERSION HISTORY DETAILS**
- Updated app screens, with changes to app screens.

**COMMITS IN THIS RELEASE**
- `feat(components): update app screens`

## 0826.0.0

**GIT COMMIT MESSAGE**
`feat(quotes): update Quotes and Projects`

**PUSHED AT**
2026-08-06T13:58:10.834Z

**WHAT CHANGED**
Update Quotes and Projects.

**VERSION HISTORY DETAILS**
- Updated Quotes and Projects, with changes to app screens, shared logic, and automated tests.
- Updated projects, with changes to app screens.

**COMMITS IN THIS RELEASE**
- `feat(quotes): update Quotes and Projects`

## 0726.11.0

**GIT COMMIT MESSAGE**
`feat(quotes): update Quotes, Projects, Data storage, and Navigation`

**PUSHED AT**
2026-07-23T23:44:44.204Z

**WHAT CHANGED**
Update Quotes, Projects, Data storage, and Navigation.

**VERSION HISTORY DETAILS**
- Updated Quotes, Projects, Data storage, and Navigation, with changes to background routes, app screens, shared logic, automated tests, and data storage.
- Updated projects, with changes to app screens, automated tests, and data storage.
- Updated data storage, with changes to automated tests and data storage.
- Updated navigation across 1 changed file.

**COMMITS IN THIS RELEASE**
- `feat(quotes): update Quotes, Projects, Data storage, and Navigation`

## 0726.10.0

**GIT COMMIT MESSAGE**
`feat(debug): update Debug tools, Fleet, Data storage, Projects, Inventory, and Help and FAQ`

**PUSHED AT**
2026-07-23T20:04:00.298Z

**WHAT CHANGED**
Update Debug tools, Fleet, Data storage, Projects, Inventory, and Help and FAQ.

**VERSION HISTORY DETAILS**
- Updated Debug tools, Fleet, Data storage, Projects, Inventory, and Help and FAQ, with changes to background routes, app screens, automated tests, and data storage.
- Updated fleet, with changes to app screens, shared logic, automation scripts, automated tests, and documentation.
- Updated inventory, with changes to shared logic, automation scripts, automated tests, and documentation.
- Updated projects, with changes to background routes, automated tests, and data storage.
- Updated data storage, with changes to shared logic, shared typing, automated tests, and data storage.
- Updated help and FAQ, with changes to app screens and documentation.

**COMMITS IN THIS RELEASE**
- `feat(debug): update Debug tools, Fleet, Data storage, Projects, Inventory, and Help and FAQ`

## 0726.9.0

**GIT COMMIT MESSAGE**
`feat(components): update app screens`

**PUSHED AT**
2026-07-23T16:53:49.824Z

**WHAT CHANGED**
Update app screens.

**VERSION HISTORY DETAILS**
- Updated app screens, with changes to app screens.

**COMMITS IN THIS RELEASE**
- `feat(components): update app screens`

## 0726.8.0

**GIT COMMIT MESSAGE**
`feat(quotes): update Quotes and Data storage`

**PUSHED AT**
2026-07-23T10:21:43.499Z

**WHAT CHANGED**
Update Quotes and Data storage.

**VERSION HISTORY DETAILS**
- Updated Quotes and Data storage, with changes to background routes, app screens, shared logic, automated tests, and data storage.
- Updated data storage, with changes to automated tests and data storage.

**COMMITS IN THIS RELEASE**
- `feat(quotes): update Quotes and Data storage`

## 0726.7.0

**GIT COMMIT MESSAGE**
`feat(customers): update Customers, Suggestions, Quotes, Data storage, Help and FAQ, Reminders, Notifications, and Projects`

**PUSHED AT**
2026-07-22T00:06:36.660Z

**WHAT CHANGED**
Update Customers, Suggestions, Quotes, Data storage, Help and FAQ, Reminders, Notifications, and Projects.

**VERSION HISTORY DETAILS**
- Updated Customers, Suggestions, Quotes, Data storage, Help and FAQ, Reminders, Notifications, and Projects, with changes to background routes, app screens, shared logic, automated tests, and data storage.
- Updated suggestions, with changes to background routes, app screens, interface components, shared logic, automation scripts, automated tests, and data storage.
- Updated data storage, with changes to shared typing, automation scripts, automated tests, and data storage.
- Updated quotes, with changes to background routes, app screens, shared logic, and automated tests.
- Updated help and FAQ, with changes to app screens, shared typing, automation scripts, and data storage.
- Updated projects, with changes to shared logic.
- Updated reminders, with changes to interface components.
- Updated notifications, with changes to interface components.

**COMMITS IN THIS RELEASE**
- `feat(customers): update Customers, Suggestions, Quotes, Data storage, Help and FAQ, Reminders, Notifications, and Projects`

## 0726.6.0

**GIT COMMIT MESSAGE**
`feat(debug): update Debug tools, Navigation, User Management, Notifications, Error reporting, and Data storage`

**PUSHED AT**
2026-07-20T21:56:53.254Z

**WHAT CHANGED**
Update Debug tools, Navigation, User Management, Notifications, Error reporting, and Data storage.

**VERSION HISTORY DETAILS**
- Updated Debug tools, Navigation, User Management, Notifications, Error reporting, and Data storage, with changes to shared logic and automated tests.
- Updated navigation, with changes to interface components.
- Updated data storage, with changes to data storage.
- Updated user management, with changes to app screens.
- Updated notifications, with changes to automated tests.
- Updated error reporting, with changes to automated tests.

**COMMITS IN THIS RELEASE**
- `feat(debug): update Debug tools, Navigation, User Management, Notifications, Error reporting, and Data storage`

## 0726.5.0

**GIT COMMIT MESSAGE**
`feat(db): update Data storage, Help and FAQ, User Management, Quotes, Error reporting, and Navigation`

**PUSHED AT**
2026-07-20T21:34:42.351Z

**WHAT CHANGED**
Update Data storage, Help and FAQ, User Management, Quotes, Error reporting, and Navigation.

**VERSION HISTORY DETAILS**
- Updated Data storage, Help and FAQ, User Management, Quotes, Error reporting, and Navigation, with changes to shared typing, automation scripts, automated tests, and data storage.
- Updated help and FAQ, with changes to background routes, app screens, shared typing, automated tests, data storage, and documentation.
- Updated quotes, with changes to shared logic, automation scripts, automated tests, and data storage.
- Updated user management, with changes to background routes, app screens, and automated tests.
- Updated error reporting, with changes to automated tests.
- Updated navigation, with changes to interface components.

**COMMITS IN THIS RELEASE**
- `feat(db): update Data storage, Help and FAQ, User Management, Quotes, Error reporting, and Navigation`

## 0726.4.1

**GIT COMMIT MESSAGE**
`chore(readme-md): update repository files`

**PUSHED AT**
2026-07-20T15:48:57.737Z

**WHAT CHANGED**
Update repository files.

**VERSION HISTORY DETAILS**
- Updated general app maintenance.

**COMMITS IN THIS RELEASE**
- `chore(readme-md): update repository files`

## 0726.4.0

**GIT COMMIT MESSAGE**
`feat(dashboard): update Dashboard, Daily Tasks, and Navigation`

**PUSHED AT**
2026-07-20T15:24:36.697Z

**WHAT CHANGED**
Update Dashboard, Daily Tasks, and Navigation.

**VERSION HISTORY DETAILS**
- Updated Dashboard, Daily Tasks, and Navigation, with changes to app screens.
- Updated daily tasks, with changes to automated tests.
- Updated navigation, with changes to automated tests.

**COMMITS IN THIS RELEASE**
- `feat(dashboard): update Dashboard, Daily Tasks, and Navigation`

## 0726.3.1

**GIT COMMIT MESSAGE**
`docs(help): update Help and FAQ and Sign in`

**PUSHED AT**
2026-07-20T14:52:07.286Z

**WHAT CHANGED**
Update Help and FAQ and Sign in.

**VERSION HISTORY DETAILS**
- Updated Help and FAQ and Sign in, with changes to automated tests and documentation.
- Updated sign in, with changes to automated tests.

**COMMITS IN THIS RELEASE**
- `docs(help): update Help and FAQ and Sign in`

## 0726.3.0

**GIT COMMIT MESSAGE**
`feat(error-reports): update error reporting`

**PUSHED AT**
2026-07-20T13:49:55.195Z

**WHAT CHANGED**
Update error reporting.

**VERSION HISTORY DETAILS**
- Updated error reporting, with changes to background routes.

**COMMITS IN THIS RELEASE**
- `feat(error-reports): update error reporting`

## 0726.2.1

**GIT COMMIT MESSAGE**
`chore(repo): update repository files`

**PUSHED AT**
2026-07-20T12:39:26.333Z

**WHAT CHANGED**
Update repository files.

**VERSION HISTORY DETAILS**
- Updated general app maintenance.

**COMMITS IN THIS RELEASE**
- `chore(repo): update repository files`

## 0726.2.0

**GIT COMMIT MESSAGE**
`feat(db): update Data storage, Navigation, Profile, and Sign in`

**PUSHED AT**
2026-07-15T22:53:43.862Z

**WHAT CHANGED**
Update Data storage, Navigation, Profile, and Sign in. Allow password login without WebAuthn config. Complete FFTS AVS parity sync. Align inherited assets and defaults with Forest Farm. Establish Forest baseline history. Close parity verification gaps. Complete Forest production sanitization. Apply Forest-safe parity schema. Add full Forest product parity. Sync dashboard and field workflows. Add secure Forest access foundation. Make FFTS production-only.

**VERSION HISTORY DETAILS**
- Updated Data storage, Navigation, Profile, and Sign in, with changes to background routes, interface components, shared logic, shared typing, automation scripts, automated tests, data storage, and documentation.
- Updated quotes, with changes to background routes, app screens, shared logic, automation scripts, automated tests, and data storage.
- Updated inventory, with changes to background routes, app screens, shared logic, automation scripts, automated tests, data storage, and documentation.
- Updated daily tasks, with changes to background routes, app screens, interface components, shared logic, shared typing, automation scripts, automated tests, data storage, and documentation.
- Updated notifications, with changes to background routes, app screens, interface components, shared logic, shared typing, automation scripts, automated tests, data storage, and documentation.
- Updated timesheets, with changes to background routes, app screens, interface components, shared logic, shared typing, automation scripts, automated tests, and data storage.
- Updated help and FAQ, with changes to app screens, interface components, shared logic, automation scripts, automated tests, data storage, and documentation.
- Updated workshop tasks, with changes to background routes, app screens, interface components, shared logic, automated tests, data storage, and documentation.

**COMMITS IN THIS RELEASE**
- `feat(db): update Data storage, Navigation, Profile, and Sign in`
- `fix(auth): allow password login without WebAuthn config`
- `merge: complete FFTS AVS parity sync`
- `fix(branding): align inherited assets and defaults with Forest Farm`
- `fix(release): establish Forest baseline history`
- `fix(validation): close parity verification gaps`
- `chore(brand): complete Forest production sanitization`
- `feat(database): apply Forest-safe parity schema`
- `feat(modules): add full Forest product parity`
- `feat(operations): sync dashboard and field workflows`
- `feat(platform): add secure Forest access foundation`
- `chore(product): make FFTS production-only`
