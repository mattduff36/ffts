# Optional site usage recordings

Use **Logging off** in the top navigation to start a diagnostic recording. The control turns red and reads **Recording**. Click again to stop. The setting and bounded pending queue belong to the current user in this browser tab. Other tabs start independently.

Uploads run every five seconds. **Pending** means events have not yet been acknowledged; **Failed** means an upload failed or the bounded offline queue lost events. Leave the tab open until pending uploads finish. Network failures retry with backoff; closing the browser can lose unsent data. This is a diagnostic logger, not an audit trail or screen replay.

Recorded data: navigation, active page time (excluding hidden time and inactivity after 60 seconds), clicked element types and a small allowlist of static control identifiers, same-origin request route/timing/status, and runtime error counts. It does not capture typed values, page text, request bodies, error messages, passwords, query strings, fragments or dynamic record identifiers. Existing basic usage analytics and security logs remain independent.

Developer access: **Debug Console → Usage Analytics → Site usage recordings**. Existing developer identity and sensitive PIN checks apply. Select a recording for its area summary and event timeline, then **Download JSON log**. The timeline shows the latest 100 loaded events. Exports contain up to 5,000 events and explicitly mark any capped recording as partial. Refresh/reselect to include new uploads; the recording list scans recent activity and supports older pages.

Storage is `public.site_usage_events`, created by `20261028103000_site_usage_monitor.sql`. Anonymous and authenticated database roles have no direct access. The authenticated upload endpoint supplies the actual user ID and deduplicates retries; only the protected developer endpoint can retrieve logs. Apply via the approved migration process before deploying the application.

Verification: focused suites `tests/unit/site-usage.test.ts` and `tests/integration/api/site-usage-route.test.ts`, TypeScript, lint and the standard release build. Live proof should start recording, navigate, stop, confirm persisted events and verify no further diagnostic events appear while off.
