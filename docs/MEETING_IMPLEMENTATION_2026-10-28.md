# Client meeting implementation — 28 October 2026

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
   - Standardize Customer → Site → Title presentation with consistent missing-value fallbacks.
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
- [x] Input and quote cleanup.
- [x] Customer/site workflow and lookup research.
- [x] Exclusive days/hours estimates.
- [x] Eight-to-sixteen teams, names, leaders and plant buckets.
- [x] Teams view, card labels, offer removal and move/resize interaction.
- [x] Resources reconciliation and visit-only board visibility.
- [x] Combined tests and preview deployment.

## Evidence and continuation

Starting checkout was clean. Prior same-day recorder/soft-refresh deployment remains the baseline. The earlier local team-settings safe-delete migration must be incorporated and verified on the approved shared sample database; its presence in Git is not proof it was applied.

29 October verification checkpoint: all implementation areas are complete. Two inspected meeting migrations were applied to the owner-approved shared sample database and db:validate passed. Initial release build passed and created local commit f840e70f. Live browser testing found and repaired a Radix site-selection reset and repeated timezone-boundary calculations that stalled Teams switching. The site regression passes 22 form tests; scheduling closure passes 104 tests. Scoped lint has zero errors and one existing hook-dependency warning.

Browser evidence: 23 of 24 scheduling/customer/quote checks passed initially; the sole stale assertion was updated to include the atomic initial timed visit and passed on rerun. Live saved-data checks passed inline customer/site selection, quote draft retention, numeric wheel protection, exclusive 90-minute storage, duration transitions and rejection, reload and independent reads. Eight-to-sixteen team settings, names, leader, Teams/Plant/Jobs switching and independent reload checks passed; original team settings were restored. Exact generated customer/site/quote fixtures were deleted. Earlier transactional migration tests covered combined people/plant membership and assignment, copy, bounds, uniqueness and occupied-slot removal, with rollback.

Evidence is under ignored testsuite/reports/meeting/: browser.log, browser-rerun.log, board-closure.json, site-regression.log, settings-live.log, lint.log and database/release logs under docs_private/automation/runs/. Full Vitest completed with 3,156 passing, 207 skipped and six initial failures. All six were resolved on targeted reruns: four stale site-label assertions, one stale release-document wording assertion, and one real-Git fixture whose unchanged checks took 70 seconds against a 60-second timeout (now the standard 120 seconds). Evidence: full-vitest.json, full-failures-closure.json (33 passing), final-two-closure.json (2 passing). Final TypeScript and closure lint pass. The final application release gate passed at 99445949; subsequent edits affect tests and evidence only. Built-app login, Jobs/Teams/Plant switching and quote creation controls passed with no page errors; Teams switched in 220 ms. Preview deployment completed and verified; no application production deployment or merge was performed.

Preview acceptance: https://ffts-hok2ldmlp-mpdees-projects.vercel.app — deployment dpl_6CT4mHj9xvvsdm8Kodw91PAfp9HF, source commit a296859731c4cbb92fc137373fae3020cf823104, release 1026.5.0, READY. Existing Vercel preview protection is preserved. Live preview sign-in, scheduling, Jobs/Teams/Plant views, inline customer action and duration inputs passed with no page errors; Teams switched in 150 ms. Evidence: testsuite/reports/meeting/preview-verification.json and preview-board.png. Production main remained 38f940a2891e435f7d9f15fa40f55800b8eb4e57 across deployment. Local finalise evidence: docs_private/automation/runs/finalise/2026-10-29T00-21-45-447Z-27224.md. All generated customer/site/quote fixtures were removed and original team settings restored. No Cursor worker was used during takeover implementation.


## 29 October: final FFTS branding and production release candidate

Owner approved a faint dark-green canvas, actual leaf logo pack, two team rows on standard widescreens, and merging the completed preview work to production.

- Canvas only uses a low-saturation green cast; neutral cards/tables and semantic/module colours are preserved.
- Actual supplied logo now appears on login/navigation, favicon, Apple/PWA icons, sharing metadata and existing PDF logo URLs. Original PNG is unchanged. Downloadable pack includes transparent light/dark wordmarks, monochrome variants, leaf marks, browser/install icons and social card. SVG wrappers preserve source raster art; a higher-resolution original remains necessary for large print.
- Team grid uses two rows from 640 to 2559 CSS pixels, one row from 2560; mobile remains two columns. Columns adapt to configured team count.
- Theme rollback was checked in an isolated Git index: applies and reverses exactly, preserving logo integration and new team layout.
- Six focused unit tests passed, scoped ESLint passed, and headed Chrome passed dashboard/scheduling/quotes/customers/timesheets/fleet plus mobile dashboard/scheduling and quote-dialog checks. Team rows were verified at 1440/1920/2560/3440 pixels, neutral timeline cards and accessible brand-button contrast were confirmed. Logo source hash, icon dimensions, ICO route and social-image dimensions passed.
- Evidence: `testsuite/reports/neutral-green/latest-*`, `logo-check.cjs`, `build-rollback.cjs` (ignored local reports). Finalise and deployed preview/production checks follow before release acceptance.
