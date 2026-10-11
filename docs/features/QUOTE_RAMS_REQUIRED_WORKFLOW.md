# Quote RAMS-required workflow

**Status:** Planned (UI stub in place)  
**Created:** 24 August 2026  
**Related:** `docs/features/RAMS_FEATURE_PRD.md`, current quote accept path (`po_received` / Accepted)

## Current shipped behaviour

Sent quotes now use **Mark as Accepted**. The confirm question is “Are RAMS required for this job?”

| Choice | Behaviour now |
|---|---|
| **No** | Calls `mark_as_accepted`. Status becomes `po_received` (Accepted). No RAMS email. No `rams_requested_at`. |
| **Yes** | Does not change status. Shows “This workflow is still being developed.” |
| **Cancel** | Closes the dialog. No status change. |

The old **Trigger RAMS** control called `trigger_rams`, which still exists on `PATCH /api/quotes/[id]`. That action both moves the quote to `po_received` and emails the internal RAMS inbox (`QUOTE_RAMS_REQUEST_EMAIL` or the admin template address), with optional CC from `quote_rams_request_copy`. It does **not** create an Actions reminder or notify the job manager as assignee.

Quote manager identity today is `quotes.requester_id`, plus denormalised `manager_name` / `manager_email`.

## Intended Yes workflow

1. **Trigger.** User clicks Mark as Accepted on a latest-version `sent` quote (details workflow or overview/current 3-dot next-status), then chooses **Yes**.
2. **Do not use the old RAMS email as the Yes path.** That email is an internal RAMS-desk request, not a manager action.
3. **Create a reminder/action** for the job manager (`requester_id`). Existing `reminder_actions` are fleet-centric (`van_id` / `plant_id` / `hgv_id`, `workflow_key`). A quote RAMS item will need either:
   - a new `workflow_key` plus `metadata.quote_id`, or
   - a dedicated quote-linked action table.
4. **Targeting.** Assign to `requester_id`. If that profile is missing or inactive, fail closed and ask the operator to pick a manager. Do not silently fall back to the RAMS inbox.
5. **Email vs in-app.** Prefer an Actions item the manager already sees, plus an optional email. Do not send the current `rams_request` template unless product still wants the RAMS desk copied.
6. **Status while waiting.** Owner decision, 11 October 2026: accept immediately (`po_received`) and track RAMS separately as outstanding. Acceptance must persist together with the outstanding RAMS record, without duplicate open actions. Do not invent a new quote status. This decision is not yet implemented by the UI stub.
7. **Completion.** Manager completes the action (and/or links a RAMS document). Timeline should record RAMS requested and RAMS completed separately from “Quote accepted”.
8. **Idempotency.** Repeat Yes on the same quote must not create duplicate open actions.

## Open questions

- Is the assignee always the quote manager, or can it be a RAMS coordinator?
- Should the existing RAMS desk email still go out in addition to the manager action?
- Reuse `reminder_actions.metadata` or add a first-class `quote_id`?

## Out of scope for the stub

Creating actions, sending manager email, writing `rams_requested_at` from the Yes button, and schema/migrations.
