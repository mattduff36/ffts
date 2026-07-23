# Scheduling sample-data runbook

This runbook authorizes one narrow exception to the repository's no-production-demo-data rule. The
fixture creates only fictional Customers, operational Quotes, synchronized scheduling jobs, and
unassigned timed visits. Every owned row is marked `scheduling-sample-v1`.

## Preconditions

1. Confirm `.env.local` points to the intended production Supabase project.
2. Set `SCHEDULING_SAMPLE_PRODUCTION_PROJECT_REF` to that project's exact reference.
3. Take a database backup or confirm point-in-time recovery is available.
4. Apply and validate the timed scheduling migration:

   ```bash
   npm run scheduling:migrate:visits
   npm run db:validate
   ```

5. Generate and review the manifest:

   ```bash
   npm run scheduling:sample:plan
   ```

The command refuses a URL/database mismatch, an incomplete schema, an existing ownership marker,
the `SD` series, or any fixture quote-reference collision. It writes a manifest under
`docs_private/automation/runs/scheduling-sample/`.

## Apply

Before applying, report the project reference, `SAMPLE Scheduling Manager` identity, `SD` series,
date window, customer/Quote/visit counts, and cleanup command to the approving operator.

Run only after the operator explicitly approves:

```bash
npm run scheduling:sample:apply -- --confirm-production=FFTS_SCHEDULING_SAMPLE
```

The fixture creates a banned placeholder auth identity, five fictional Customers, 22 latest open
Quotes, their synchronized jobs, and unassigned visits. It verifies each job number matches its
Quote base reference.

## Queue extension

When the base fixture already exists, a separately guarded extension can add Jobs-tab coverage
without creating another auth identity or ownership marker:

```bash
npm run scheduling:sample:queue:plan
```

The extension requires the base fixture identity, Customers, Quote/job set, and inactive series to
remain intact, while allowing extra visits created during testing. It refuses any `99022-SD` to
`99033-SD` reference collision. It plans 12 additional Quotes under the existing
`scheduling-sample-v1` owner: nine unscheduled Quotes split equally across the Draft, Pending, and
Accepted scheduling groups, plus three dated Quotes with unassigned visits.

Before applying, report the project reference, existing `SAMPLE Scheduling Manager` identity,
`SD` extension range, date window, Quote/job/visit counts, status-group counts, and the shared
cleanup command. Apply only after explicit approval:

```bash
npm run scheduling:sample:queue:apply -- --confirm-production=FFTS_SCHEDULING_SAMPLE
```

The normal ownership-checked cleanup command removes the base fixture and this extension together.

## Verify

1. Confirm the apply command reports 5 Customers, 22 Quotes, 22 jobs, the manifest visit count, and
   zero employee/plant assignments.
2. Open `/scheduling` for each of the four weeks and check timed visits.
3. Open several source Quotes and confirm their base references match the displayed job numbers.
4. Check the employee schedule remains unaffected because no resources are assigned.

## Cleanup

Preview owned row counts:

```bash
npm run scheduling:sample:cleanup -- --dry-run
```

Remove the fixture only after approval:

```bash
npm run scheduling:sample:cleanup -- --confirm-production=FFTS_SCHEDULING_SAMPLE
```

Cleanup aborts if ownership markers do not resolve to one matching SAMPLE auth/profile identity or
if any fixture visit has acquired an employee or plant assignment.

## Recovery

- Apply failure before database commit removes the newly created auth identity and leaves no fixture
  database rows.
- If cleanup reports that database rows were removed but auth cleanup failed, delete only
  `scheduling-sample-v1@example.test` after verifying its metadata contains
  `placeholder_key=scheduling-sample-v1`.
- Never weaken ownership checks or manually broaden cleanup predicates. Investigate unexpected rows
  and restore from backup if ownership is uncertain.
