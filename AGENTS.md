# FFTS task router

- Work in this checkout and on the current branch unless the owner directs otherwise. Read `.cursor/rules/ffts-core.mdc` for durable safety and Git rules, `.cursor/rules/sample-data-phase.mdc` for the current SAMPLE DATA lane override, and `.cursor/rules/workspace-independence.mdc` for repository boundaries.
- For database, schema, persistence, SQL, RLS, backfill, or migration work, read `.cursor/rules/database-migrations.mdc` and `docs/guides/HOW_TO_RUN_MIGRATIONS.md` before acting. Keep destructive production changes explicitly authorised and run `npm run db:validate` after a rename or drop.
- For finalise, release, or push, read `.cursor/rules/finalise-commands.mdc` and `scripts/README.md`; use the existing `.cursor/commands/` adapter for the invoked command. A local finalise does not authorise push. `fap` and `ffap` do only when explicitly invoked as the current action.
- For scripts, testsuite, finalise, fixerrors, or command behavior changes, follow `.cursor/rules/operational-docs.mdc` and update the nearest operational README.
- The global TEE skill controls workflow preference and topology. Use existing protocol tooling only when a TEE-FULL workstream applies. Preserve legacy review records; an exhausted generation requires an explicit owner-authorised successor before another first/closure review. No worktree or branch change is required merely for continuation.

## Application context

| Task | Selective context |
| --- | --- |
| Tiny UI fix / ordinary bug | Affected source, adjacent tests and the matching scoped rule; README.md for commands only. |
| Product/domain change | README.md product areas, relevant module guide found through docs/README.md, live code/tests. Workshop tasks: docs/PRD_WORKSHOP_TASKS.md. |
| Substantial UI / architecture | Relevant sections of docs/DEVELOPMENT_STANDARDS_AND_TEMPLATES.md and the current module pattern. Investigate discrepancies with live code rather than imposing a broad migration. |
| Auth / permissions / data | Relevant server authorization and RLS code, applicable database rule and focused allowed/denied tests. |
| Operational fixerrors task | .cursor/commands/fixerrors.md and its registered safety contract; never import customer logs into general context. |

## Do NOT load

Do not load the full docs tree, unrelated module PRDs, historical review runs, sibling repositories, or release/protocol procedures for an ordinary local fix. No new stage artifacts for DIRECT/FAST work. Use the existing task/plan for a useful handoff: scope, selected inputs, evidence and next action; use existing protocol artifacts only for TEE-FULL. There is no additional CONTEXT.md or state engine.
