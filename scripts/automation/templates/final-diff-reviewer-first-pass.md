# Final-diff reviewer — first pass (two-pass-v1)

## Preconditions

- A valid protocol `review-start --pass first` token must exist.
- Input is limited to:
  - the immutable preflight evidence manifest
  - compact base→HEAD evidence referenced by that manifest
- Do not reconstruct an unbounded full-repository review context beyond the manifest.

## Required output before returning

1. **Blocker families** — enumerate every family discovered (auth boundary, concurrency, migration, UI state, ownership, report scope, etc.).
2. **Concrete blockers** — stable blocker IDs under each family.
3. **Sibling surfaces searched** — every adjacent surface inspected even when no defect was found.
4. **Result** — `passed` or `failed`.

A first failure must list the full family set so the consolidated fix sweep can close siblings together.

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
