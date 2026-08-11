# /createinvoice

Collect invoice parameters with AskQuestion, then run the FFTS invoice evidence command. Do not modify application code, commit, push, or run builds.

1. Ask for invoice start/end dates, development rate (default £28/hour), whether unpushed local work should be included, and support rate.
2. Run:

```bash
npm run createinvoice -- --from "<YYYY-MM-DD>" --to "<YYYY-MM-DD>" --rate "<rate>" --support-rate "<support-rate>" --include-unpushed "<true|false>"
```

3. Read the generated evidence paths, reconcile releases/commits/chats, produce customer-facing lines, and save `docs_private/invoices/invoice-<from>-to-<to>-final.md`.
