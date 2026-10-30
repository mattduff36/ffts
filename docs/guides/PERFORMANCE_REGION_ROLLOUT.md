# London function placement: gated rollout

This local candidate adds `regions: ["lhr1"]` in `vercel.json`. It preserves all cron paths/schedules and changes no database, pooler, credentials or provider settings. A local setting is not evidence of deployed placement or lower latency.

## Verified baseline and official configuration

Read-only provider metadata during the 29–30 October 2026 implementation session identifies FFTS production as READY, from `main` at `adca6f82345945fcead202d21d2390fc07dadc1e`, with deployment region `iad1`. None of the performance implementation commits had been deployed by this work. Recheck current metadata before a comparison; production may have changed.

[Vercel's region configuration](https://vercel.com/docs/functions/configuring-functions/region) supports the top-level `regions` array and recommends placing functions near their data source. Per-function settings can override that default; middleware and static CDN delivery have different placement behavior. The [configuration reference](https://vercel.com/docs/project-configuration) documents project configuration separately from effective deployments. Guidance was verified during this session. No runtime placement or speedup is claimed for this candidate.

## Release boundaries

Keep four packages identifiable: application quick wins (01–04B), progressive PDF preview (05), private SELECT-policy draft/validation (06), and region rollout (07). The current branch contains several packages. Do not push its HEAD as an application-only release: that would also include this region setting. No database draft is an automatically discovered migration.

No build, preview, push, deployment, production promotion, live provider edit, migration application, external delivery or scheduled job execution is authorised by this guide. Obtain separate owner approval for the exact candidate and actions. Follow FFTS release rules and the current command adapter before an approved release; this document is not permission to run finalise.

## Matched comparison after explicit approval

1. Record the intended Git SHA, environment, runtime, region, fixture, auth/effective role/team, device, network, build mode and cache state. Use identical application code and build inputs in the `iad1` and `lhr1` comparison. The audited SHA differs from the application candidate; comparing them directly confounds application and region effects.
2. Obtain approval for both matched preview candidates and their exact deployment method. Preserve the existing crons in source. Check preview cron/integration configuration read-only; do not trigger jobs or send messages. Preview may share production data, so use read-only flows and an approved isolated target for mutation checks.
3. Verify each deployment's Git SHA, effective function region and routing/overrides through provider metadata. Where appropriate corroborate actual function execution region. A hostname or `vercel.json` setting alone does not prove where a function ran. Do not weaken deployment protection to obtain access.
4. Collect repeated authenticated read samples for quote list, scheduling board and dashboard APIs. Separate first/cold samples from warm samples; keep auth context, query, fixture and order comparable. Record sample counts and median/range, plus failures. Do not report p95 from a handful of observations or attribute a code change to region.
5. Smoke-test login/session/PIN behavior, ordinary/signing PDF responses and approved isolated upload flows. Do not automate writes against a preview sharing production data. Check cron paths/schedules and integration configuration without executing them. Retain private, sanitised evidence.
6. Present results, effective deployment identities, missing checks, rollback and proposed promotion to the owner. Promote only after separate approval and evidence supports it. Static/browser-direct requests need not improve when the function location changes.

## Rollback

Before any approved rollout record the known-good deployment identity and its configuration. For a region regression, route back to that approved deployment under owner authorisation, then revert the region commit in source as appropriate. If redeploying, use the approved previous candidate with the previous region configuration and verify effective placement and workflow behavior. A local revert alone does not change live traffic. Do not apply or roll back the separate RLS draft as part of a region rollback.

## Outstanding evidence

Local JSON/cron preservation can be checked without deployment. Candidate build/chunk evidence, matched authorised previews, effective `lhr1` execution, authenticated browser checks and repeated API measurements are still required. There is no region-based performance or promotion acceptance yet.
