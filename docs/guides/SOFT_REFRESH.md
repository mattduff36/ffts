# Soft refresh coverage

Shared behaviour lives in `useSoftRefresh` (`lib/hooks/useSoftRefresh.ts`): 15s interval, plus `focus`, `online`, and `visibilitychange`, only while the document is visible and the browser is online. A run is skipped when one is already in flight, when the last start was under 2s ago, or when `isSoftRefreshPaused()` is true. Dirty dialogs pause refresh through `useDirtyDialogGuard`.

`QueryProvider` also refetches active, idle React Query queries on that same hook. It skips the pass while a mutation is in flight. That covers React Query readers only. Pages that load with `fetch` or the Supabase client need their own hook.

Background calls added below use an optional `background` flag (default `false`) so the normal caller still drives the first-load spinner. A background pass does not set the page loading flag, does not replace a failed read with an empty list, and does not clear filters or search.

## Wired saved reads

| Surface | Callback | Runs when | Background guard |
| --- | --- | --- | --- |
| Dashboard metric badges and pending-approval counts | `loadDashboardMetrics(true)` | Profile is ready and the first load has finished | Skips loading/badge spinners. Keeps the last counts on failure. Records an auth status so the existing recovery effect can run. RAMS assignment counts stay on `useRamsAssignmentSummary` (React Query). |
| Actions summary cards | `loadSummary(true)` | Actions permission is granted | Read-only. Omits `ensure_fresh`, which can write fleet-inspection reminder actions. Does not bump `refreshToken`. |
| Approvals timesheet list | `fetchApprovals(true)` | Approvals permission, not the first load, process modal closed | Skips the timesheet section loader. A newer request wins. Absence rows stay on `useAllAbsences` (React Query). |
| Inventory lists | `fetchInventoryData(true)` | Inventory permission, not the first load, no item/location/move/retire/confirm dialog | Does not return the full-page loader. |
| Timesheets list | `fetchTimesheets(true)` | Timesheets permission, not the first load, delete dialog closed | Skips the panel loader and does not set the inline fetch error. `useTimesheetRealtime` still calls `fetchTimesheets()` with the foreground loader. |
| Projects document list | `fetchDocuments(true)` | RAMS permission, not the first load, visitor sign modal closed | Skips the full-page loader. Search and status filters reapply from existing state. |
| Training records, people, qualifications, notes, summary | `loadTrainingData(false, true)` | Training permission, not loading or exporting, no record/person/qualification editor and no archive in progress | Does not show the Refresh spinner. |

Priority routes: Customers list/history; Quotes current/legacy/projects lists, overview search, individual overview, details modal and work calendar. Background quote-detail reads recheck draft state before applying a response. Scheduling manager board, Resources queues, backlog, context and employee schedule use active React Query reads. Scheduling reads bypass browser cache; open scheduling editors, drags and pending saves pause automatic refresh.

Additional saved lists: van, plant and HGV inspection lists, reminders and notifications. These retain existing first-load behavior and refresh saved data in the background.

This is bounded polling, not a push subscription: visible online screens normally see committed changes on the next 15-second tick plus request time. Hidden/offline tabs catch up when returned/reconnected. Dirty dialogs and scheduling interactions intentionally delay refresh until safe. Open forms retain their draft; this does not implement concurrent-edit conflict resolution.

## Explicit exceptions

These are follow-up planning items for the older bespoke screens, beyond the urgent priority rollout:

- Actions row lists: `ActionsOverviewPanel`, `IgnoredActionsPanel`, `ActionedActionsPanel`, `QuoteRamsActionsPanel`. Their loaders set loading immediately, and the overview loader sends `ensure_fresh`.
- Inspection create/detail screens (`*/new`, `*/[id]`), timesheet create/detail (`timesheets/new`, `timesheets/[id]`), and other draft or edit forms. Do not poll those.
- Profile overview and settings (`fetchProfileOverview` also hydrates an editable draft).
- Fleet list and fleet history pages (`fleet/page.tsx`, van/plant/HGV/vehicle history). Those history pages also load maintenance, workshop, and daily-check data.
- Other raw-fetch admin/settings panels and workshop local state need individual review. Maintenance, absence and projects management query-backed data are covered by the shared provider; raw local state within those modules is not automatically covered.

Do not treat this list as complete for every route under `app/(dashboard)`. A page is covered only when it is named above or its data is an active React Query.

## Verification

`tests/unit/useSoftRefresh.test.ts`, `tests/unit/useDirtyDialogGuard.test.ts` and `tests/ui/query-provider-soft-refresh.test.tsx` verify visible/online scheduling, retry/no overlap, cleanup, draft locks, two independent query caches receiving a saved update, and disabled queries remaining untouched. Run TypeScript, scoped lint and the normal finalise build before release.
