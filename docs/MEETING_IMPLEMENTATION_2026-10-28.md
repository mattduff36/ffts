# Client meeting implementation â€” 28 October 2026

## Approved scope and release boundary

Work on `codex/meeting-2026-10-28-preview`, based on production commit `fc84b4c2`. Complete the combined changes, run focused tests and E2E/smoke checks, then deploy a preview for owner review. Do not merge or deploy the application to production without subsequent approval. The owner explicitly approved using the shared production database because it contains only sample/test data. Apply inspected, backward-compatible migrations there; preserve existing data. No paid address service may be enabled without approval.

## Product decisions

- Eight scheduling buckets by default; add/remove extra buckets individually up to sixteen. Custom names persist across dates; blank names fall back to leader-based names. Preserve existing memberships and leadership.
- Teams view means scheduling buckets. Assigning a dragged bucket assigns its employees and plant together. Initially omit an Unassigned row; Jobs view continues to show visits without buckets.
- Estimated duration uses days OR hours, never an additive combination. Preserve existing day estimates; support sub-day hour estimates. Timed visits determine actual placement on the board.
- Moving the body of a scheduled visit shifts both endpoints equally and keeps the full-size card visible. Edge handles resize one endpoint. Preserve existing cross-day moves without adding a new day-view workflow.
- Preserve the jobs column. Show Customer, Site name, Title in that order in resource cards, visit cards and related quote/history displays.
- Address lookup deliverable is research and a recommendation; paid integration requires separate approval. Manual customer/site creation must work independently.

## Implementation sequence and acceptance

1. **Low-risk input and quote cleanup**
   - Remove the imported email-draft beta banner and its quote-creation wiring; remove orphaned code only when exclusive to this feature.
   - Disable numeric spinners and wheel-based value changes site-wide. Keep ordinary numeric entry and validation; permit a temporary empty draft rather than coercing every keystroke to zero. Audit currency/number handlers in quote and shared forms.
   - Replace repetitive scheduling success toasts with one compact, accessible Done/tick acknowledgement. Preserve informative error messages. Audit equivalent high-frequency actions elsewhere.
2. **Customer and site workflow**
   - Add inline New customer and New site actions to scheduling quote creation, and New site to the main quote form.
   - Save against the correct customer; immediately select the created customer/site; preserve the quote draft and normal permission/PIN gates.
   - Make adding a site directly accessible in customer history/details, with new sites first, searchable/collapsible browsing as appropriate, and no long-scroll dependency on the full customer editor.
   - Research open-source/free business/address search and current Google/what3words costs, usage restrictions, attribution and coverage. No provider enabled without the approved selection.
3. **Duration model**
   - Add mutually exclusive hours/days inputs, storage, API validation, types and display. Retain existing estimates and identify downstream calendar/scheduling consumers before changing conversion behavior.
   - Test empty/zero/sub-day values, exclusivity, updates and existing day-only quotes. An estimate never creates an untimed board job.
4. **Team settings, schema and plant membership**
   - Expand all database/API/UI bounds to default eight/max sixteen, including standing leaders. Fix save failures and persist optional names.
   - Add typed plant membership to daily buckets, copy operations and assignment operations. Keep employee and plant capacity/conflict rules distinct, enforce permissions and preserve the existing conflict-aware partial-assignment behavior, and preserve existing employee memberships.
   - Test slot eight/sixteen, duplicate leaders, name fallback, settings round-trip, occupied-slot removal, employee/plant bucket copy and combined visit assignment.
5. **Scheduling views and card interaction**
   - Replace the Employees board view with bucket-based Teams rows; verify Jobs and Plant views still work.
   - Standardize Customer â†’ Site â†’ Title presentation with consistent missing-value fallbacks.
   - Remove Offer if crew free controls and their active filtering behavior; avoid destructive history deletion.
   - Implement full-card horizontal movement separately from edge resizing and resource-to-board dragging. Preserve duration, snapping, bounds and optimistic rollback on failures.
6. **Resource queue and visit-only visibility**
   - Reconcile quote create/update with Resources lists, including cross-tab refresh.
   - Render board jobs only when a timed visit overlaps the displayed day/week. Test unscheduled jobs, estimates without visits, dates outside the period, moved/deleted visits and boundary times.
7. **Combined verification and preview**
   - Review every diff and migration. Run focused unit/API/UI tests, database checks against the owner-approved shared sample database, TypeScript/lint and the project release build/gate.
   - Browser E2E: create customer/site/quote, select new site, duration edits, eight-to-sixteen team settings/names/leaders, employee-plus-plant assignment, Teams/Jobs/Plant views, move/resize, queue refresh and visit-only board visibility. Verify persistence after reload and a second reader. Verify numeric scrolling and draft retention.
   - Deploy Preview only after the complete candidate passes. Provide preview URL, exact commit, evidence, research recommendation and any limitations. Owner performs manual acceptance before production approval.

## Progress

- [x] Requirements clarified and preview branch created.
- [x] Database target resolved: owner authorises shared production database containing only sample/test data.
- [ ] Input and quote cleanup.
- [ ] Customer/site workflow and lookup research.
- [ ] Exclusive days/hours estimates.
- [ ] Eight-to-sixteen teams, names, leaders and plant buckets.
- [ ] Teams view, card labels, offer removal and move/resize interaction.
- [ ] Resources reconciliation and visit-only board visibility.
- [ ] Combined tests and preview deployment.

## Evidence and continuation

Starting checkout was clean. Prior same-day recorder/soft-refresh deployment remains the baseline. The earlier local team-settings safe-delete migration must be incorporated and verified on the approved shared sample database; its presence in Git is not proof it was applied.

28 October 22:37 checkpoint: input/banner cleanup passed 27 UI tests and scoped lint; retired assist endpoint removed. Team settings core/API/new migration reviewed; UI names and 8..16 integration added, focused checks pending. No meeting migrations applied or preview deployed yet. Hours will reuse existing estimated_duration_minutes storage.

28 October 22:37 checkpoint: input/banner cleanup passed 27 UI tests and scoped lint; retired assist endpoint removed. Team settings core/API/new migration reviewed; UI names and 8..16 integration added, focused checks pending. No meeting migrations applied or preview deployed yet. Hours will reuse existing estimated_duration_minutes storage.

28 October 23:38 checkpoint: team settings and plant storage/assignment/UI implemented and reviewed; two migrations passed rollback-only pg verification but are not applied persistently. Visit-only board and dated-quote Resources filtering passed focused checks. Site creation API and customer/main-quote UX implemented; 41 focused API/UI/helper checks pass including failed draft retention and duplicate-submit prevention. Retired offer controls removed and compact Done acknowledgements integrated, preserving errors/Undo/partial details. Full scheduling component rerun and typecheck in progress. Remaining: exclusive duration, scheduling inline customer/site, Teams view, consistent labels, browser verification and preview release.
