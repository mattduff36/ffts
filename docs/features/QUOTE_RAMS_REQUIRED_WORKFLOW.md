# Quote RAMS-required workflow

Status: Implemented locally on 11 October 2026; pending release after review.

## Agreed behaviour

- Yes accepts the latest sent, commercially open quote immediately (`po_received`) and creates one outstanding quote RAMS action in the same database transaction. Cancel makes no change. No preserves the existing acceptance path without RAMS.
- Assign the active quote manager (`requester_id` in `quote_manager_series`); require explicit eligible manager selection if missing/inactive. Managers/admins can reassign an open action.
- Email only the assigned manager after commit. No RAMS desk or automatic CC. Failure leaves acceptance and action saved with a visible warning and explicit retry. Reassignment emails the new owner.
- Complete only with an active RAMS document linked to this quote, confirmed by its assigned manager or an admin. Record completion and assignment changes in the quote timeline.
- Existing Projects document upload/linking is used. No placeholder documents or fabricated safety information.

## Implementation

Migration `20261011220000_quote_rams_actions.sql` adds the dedicated table, one action per quote, RLS and direct-write restrictions. Applied to the shared sample database on 11 October; production code remains on the earlier team-colour release until a separate release.

`GET/POST /api/quotes/[id]/rams-action` provides context and accept/reassign/complete/retry-email. `GET /api/quote-rams-actions` lists owned actions or authorized management actions. Both quote acceptance entry points use the new path; quote Workflow and Actions > RAMS expose tracking and completion.

Quote context remains subject to Quotes permission and its sensitive-access PIN. Managers assigned an action must retain that access to use the detail UI. Standalone Reminders remains unlisted, as agreed.

## Delivery and lifecycle limits

- Sending is claimed atomically to prevent duplicate delivery. Sent, currently sending and uncertain deliveries are not automatically retried. An interrupted/uncertain provider result requires manual reconciliation; no background retry worker is implemented.
- Existing accepted quotes and old Trigger RAMS activity are not automatically backfilled into actions. The legacy `trigger_rams` endpoint is preserved and is not called by the new Yes flow.
- Quote versions have separate IDs. Superseding/cancelling an outstanding RAMS action across quote versions is not automated.
- Provider delivery has not been tested by sending real email. Verification uses mocked delivery and real PostgreSQL transactions rolled back after assertions.

## Verification

Focused API, service and UI tests cover acceptance, missing manager, duplicate prevention, email failure, ownership, linked documents and completion. Real PostgreSQL checks cover transaction rollback, atomic acceptance/action, duplicate requests, completion permission replay and RLS write denial. Browser checks cover the quote prompt, quote Workflow context and Actions RAMS list. No real emails were sent by these checks.
