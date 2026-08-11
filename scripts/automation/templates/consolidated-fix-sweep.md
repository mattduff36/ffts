# Consolidated fix / family sweep (two-pass-v1)

After the first failed premium review:

1. Do **not** launch another reviewer immediately.
2. Sweep the entire blocker family and named sibling surfaces in one fix pass.
3. Run targeted checks only.
4. Produce a `fix-delta` evidence manifest mapping every open blocker ID to closure evidence.
5. Record the fix:

```bash
npx tsx scripts/workflow-protocol.ts fix-record \
  --workstream <id> \
  --manifest <fix-delta-manifest> \
  --closed-blocker-ids <csv>
```

6. Only then request a closure review via `review-start --pass closure`.
