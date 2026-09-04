# Scheduling Implementation

This guide captures the Schedule Board product behaviour and deferred enhancements for Forest Farm Tree Services.

## Current behaviour

- Scheduling is visit-based. Employees and plant remain available for other non-overlapping visits on the same day.
- Managers can create quoted work from the board, reserve Project Numbers, place open Projects onto the calendar, and use **Quick add** for emergency jobs.
- Quick add creates a formal Project Number, schedule job, and timed visit in one step for an existing customer/site. No quote or RAMS document upload is required.
- Resource cards expose a dedicated drag handle for touch-first drag-and-drop. Selecting a visit and tapping a resource remains supported.
- Daily team buckets (default five, up to ten via Settings) let managers assemble an organisation-shared crew of up to six employees, including a standing team leader, for the selected date, then drag the whole bucket onto a timed visit. Leaders persist in settings and are implicit members every day. Employees appear in Resources or a bucket, never both. Conflicted people are skipped and reported; the bucket stays filled. This is independent of org team filters.
- Board mutations update the local cache immediately and reconcile with the server in the background.

## Optimistic mutation contract

- The manager board renders each confirmed scheduling action from an in-memory operation ledger before its network request resolves. The ledger projects over React Query's latest server data, so a refetch cannot hide pending work.
- Assignment create/move/delete/restore/override and day-team-to-visit go through one mutation coordinator. Admission always projects a valid later intention. Persistence is queued only when exclusive business claims overlap an in-flight command.
- Assignment persistence coordinates by `resource_type + resource_id + work_date`, matching PostgreSQL advisory locks. Two employees on the same job do not block each other. Shared job/visit claims do not exclusive-lock sibling assignments.
- Additive creates stay additive. Repeated unsent moves of the same assignment coalesce to the latest target and keep the original request ID. An executing move plus a newer move keeps the newest projection and queues a new request ID.
- Ambiguous TypeError/5xx failures keep the projection and retry the same request ID with bounded backoff. Genuine 409 conflicts are not swallowed.
- Board, Jobs queue, resource availability, and plant-unavailability changes are projected together. Numeric employee-capacity totals remain server-authoritative because the board does not contain the complete shift and absence basis needed to calculate exact totals locally.
- Confirmations remain safety gates. Visit-return dialogs open immediately, but their final action remains disabled until the authoritative fingerprint and assignment count are available.
- Successful responses replace provisional IDs and fields with authoritative entities. Reconciliation is scoped to the affected week or sidebar query and never blocks the initiating interaction.
- A rejected or stale request removes only its own operation. Concurrent successful or pending changes are preserved; whole-board snapshot rollback and broad scheduling-board invalidation are prohibited.
- Cross-tab optimistic state is intentionally not shared. Other tabs converge when their server data is refreshed.
- Assigning a resource onto a still-provisional `optimistic:*` visit remains deferred. The current wait toast and client ID guard stay in place.

## Assignment idempotency

- Client assignment mutations mint a stable `request_id` when the logical command is created and reuse it across retries.
- Server wrappers `create_schedule_assignment_v2`, `create_schedule_assignments_bulk_v2`, `move_schedule_assignment_v2`, and `delete_schedule_assignment_v2` follow the visit-transition pattern: request-id advisory lock, input hash, stored result, exact replay, and `REQUEST_ID_REUSED` on changed input.
- These wrappers call the proven v1 overlap/move functions. They do not take a second resource-day advisory lock. If a v2 RPC is missing, the API falls back to v1.
- The `schedule_assignment_mutation_requests` table has no foreign key to assignment rows, so delete replay survives the deleted row.
- A development-only delay can be injected with `NEXT_PUBLIC_SCHEDULING_MUTATION_DELAY_MS` when `NODE_ENV=development`.

## Future Enhancements (Deferred)

These ideas are intentionally deferred and must not be treated as current scope:

- Expanding team-bucket editor and leaders on extra teams 6–10.
- Saved team templates and standing multi-day crews for emergency call-outs.
- Weekly-view team buckets.
- Cross-tab realtime schedule synchronisation.
- Dependent optimistic commands that assign onto a visit that still has an `optimistic:*` ID.
- Full decomposition of the Schedule Board monolith beyond the Quick add dialog, day-team buckets, and cache helpers already extracted.

## Related files

- Board UI: `app/(dashboard)/scheduling/components/SchedulingManagerBoard.tsx`
- Quick add dialog: `app/(dashboard)/scheduling/components/ScheduleBoardQuickAddDialog.tsx`
- Cache helpers: `app/(dashboard)/scheduling/components/scheduling-board-cache.ts`
- Persistence: `supabase/migrations/20260810214500_schedule_board_quick_add_v1.sql`, `supabase/migrations/20260901170000_schedule_day_teams.sql`, `supabase/migrations/20260901210000_schedule_assignment_mutation_requests.sql`
- Mutation coordinator: `app/(dashboard)/scheduling/components/scheduling-mutation-coordinator.ts`, `app/(dashboard)/scheduling/components/scheduling-mutation-claims.ts`
- Day teams UI: `app/(dashboard)/scheduling/components/ScheduleDayTeamBuckets.tsx`
- Sample data: `docs/guides/SCHEDULING_SAMPLE_DATA_RUNBOOK.md`
