# Final-diff reviewer — closure / delta pass (two-pass-v1)

## Preconditions

- A valid protocol `review-start --pass closure` token must exist.
- Input is limited to:
  - original blocker IDs / families from the first failed review
  - the fix-delta evidence manifest
  - closure evidence mapping each blocker ID to targeted checks
- Do not regenerate or reload a full branch review context.

## Required output before returning

For each original blocker ID: `closed`, `open`, or `regression`.
Report only newly introduced risks outside the original set.
Result must be `passed` or `failed`.

A second failure transitions the lineage to `routing_required`. Do not launch a third premium review for the same CRITICAL continuation. Routing or split does not reset this budget. Remaining work is routing, isolation, or proven removal from release — not another normal final-diff pass.

## Recording

```bash
npx tsx scripts/workflow-protocol.ts review-record \
  --workstream <id> \
  --token <token> \
  --result passed|failed \
  --blocker-families <csv> \
  --blocker-ids <csv> \
  --sibling-surfaces <csv>
```
