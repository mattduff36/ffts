# Scheduling Implementation

This guide captures the Schedule Board product behaviour and deferred enhancements for Forest Farm Tree Services.

## Current behaviour

- Scheduling is visit-based. Employees and plant remain available for other non-overlapping visits on the same day.
- Managers can create quoted work from the board, reserve Project Numbers, place open Projects onto the calendar, and use **Quick add** for emergency jobs.
- Quick add creates a formal Project Number, schedule job, and timed visit in one step for an existing customer/site. No quote or RAMS document upload is required.
- Resource cards expose a dedicated drag handle for touch-first drag-and-drop. Selecting a visit and tapping a resource remains supported.
- Daily **Team 1–3** buckets let managers assemble an organisation-shared crew of up to six employees for the selected date, then drag the whole bucket onto a timed visit. Conflicted people are skipped and reported; the bucket stays filled. This is independent of org team filters.
- Board mutations update the local cache immediately and reconcile with the server in the background.

## Optimistic mutation contract

- The manager board renders each confirmed scheduling action from an in-memory operation ledger before its network request resolves. The ledger projects over React Query's latest server data, so a refetch cannot hide pending work.
- Board, Jobs queue, resource availability, and plant-unavailability changes are projected together. Numeric employee-capacity totals remain server-authoritative because the board does not contain the complete shift and absence basis needed to calculate exact totals locally.
- Confirmations remain safety gates. Visit-return dialogs open immediately, but their final action remains disabled until the authoritative fingerprint and assignment count are available.
- Successful responses replace provisional IDs and fields with authoritative entities. Reconciliation is scoped to the affected week or sidebar query and never blocks the initiating interaction.
- A rejected or stale request removes only its own operation. Concurrent successful or pending changes are preserved; whole-board snapshot rollback and broad scheduling-board invalidation are prohibited.
- Cross-tab optimistic state is intentionally not shared. Other tabs converge when their server data is refreshed.

## Future Enhancements (Deferred)

These ideas are intentionally deferred and must not be treated as current scope:

- Saved team templates and standing multi-day crews for emergency call-outs.
- Weekly-view team buckets.
- Cross-tab realtime schedule synchronisation.
- Full decomposition of the Schedule Board monolith beyond the Quick add dialog, day-team buckets, and cache helpers already extracted.

## Related files

- Board UI: `app/(dashboard)/scheduling/components/SchedulingManagerBoard.tsx`
- Quick add dialog: `app/(dashboard)/scheduling/components/ScheduleBoardQuickAddDialog.tsx`
- Cache helpers: `app/(dashboard)/scheduling/components/scheduling-board-cache.ts`
- Persistence: `supabase/migrations/20260810214500_schedule_board_quick_add_v1.sql`, `supabase/migrations/20260901170000_schedule_day_teams.sql`
- Day teams UI: `app/(dashboard)/scheduling/components/ScheduleDayTeamBuckets.tsx`
- Sample data: `docs/guides/SCHEDULING_SAMPLE_DATA_RUNBOOK.md`
