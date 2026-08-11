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

A second failure transitions the workstream to `routing_required` (premium-fix-routing or split). A third review-start is rejected.

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
