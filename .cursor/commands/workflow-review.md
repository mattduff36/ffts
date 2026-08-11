# /workflow-review

1. Run `npm run workflow-review`.
2. Summarize lane distribution, selected parent models, anomalies, failed/unknown findings, and low-confidence estimated premium-token savings. Never claim exact IDE token usage.
3. If a pending follow-up artifact is printed, read it, use AskQuestion to collect approve/reject/skip for every suggestion, then run:
   `npm run automation:followup:resolve -- --pending "<path>" --decision "<id>=approve|reject|skip"`
   with one decision per suggestion.
4. If the resolver prints a Cursor plan path under `docs_private/automation/plans/`, report that it is ready for review/build.
5. Never push from this command.
