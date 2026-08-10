# Scheduling Implementation

This guide captures the Schedule Board product behaviour and deferred enhancements for Forest Farm Tree Services.

## Current behaviour

- Scheduling is visit-based. Employees and plant remain available for other non-overlapping visits on the same day.
- Managers can create quoted work from the board, reserve Project Numbers, place open Projects onto the calendar, and use **Quick add** for emergency jobs.
- Quick add creates a formal Project Number, schedule job, and timed visit in one step for an existing customer/site. No quote or RAMS document upload is required.
- Resource cards expose a dedicated drag handle for touch-first drag-and-drop. Selecting a visit and tapping a resource remains supported.
- Board mutations update the local cache immediately and reconcile with the server in the background.

## Future Enhancements (Deferred)

These ideas are intentionally deferred and must not be treated as current scope:

- Team-based booking: compose a day team once, then assign that team (or a subset) to one or more jobs without re-selecting every employee for each visit.
- Bulk team day composition workflows and saved team templates for emergency call-outs.
- Cross-tab realtime schedule synchronisation.
- Full decomposition of the Schedule Board monolith beyond the Quick add dialog and cache helpers already extracted.

## Related files

- Board UI: `app/(dashboard)/scheduling/components/SchedulingManagerBoard.tsx`
- Quick add dialog: `app/(dashboard)/scheduling/components/ScheduleBoardQuickAddDialog.tsx`
- Cache helpers: `app/(dashboard)/scheduling/components/scheduling-board-cache.ts`
- Persistence: `supabase/migrations/20260810214500_schedule_board_quick_add_v1.sql`
- Sample data: `docs/guides/SCHEDULING_SAMPLE_DATA_RUNBOOK.md`
