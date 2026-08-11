# TEE V2.2 Verification Ledger (FFTS)

Master workstream: `ws_5a7b2d5716a10c27`  
Core workstream: `ws_8670b5ee93738ff1`  
Finalise workstream: `ws_0a0f7fc081bc9fad`  
Fixerrors workstream: `ws_db20217d5f1cd7d2`  
Architecture gate (core/finalise): `approved_with_conditions` (`255309b1-9c98-4383-934a-832aef8d63c6`)  
Architecture gate (fixerrors): `approved_with_conditions` (`b9e470ec-3173-4fbe-8c6c-e1aaa7c9178f`)

Statuses below reflect deterministic verification evidence. Missing/stale evidence remains `unknown`, never passed.

**Closure note (Workstream 1):** Two independent premium final-diff review rounds both `BLOCKED`. Premium fix-routing chose `FIX_IN_PLACE`; routed fixes were applied and re-verified deterministically. Protocol moved to `routing_required` for manual handoff. No third premium review was launched or claimed as passed.

**Closure note (Workstream 2):** Two independent premium final-diff review rounds both `BLOCKED`. Premium fix-routing chose `FIX_IN_PLACE`; remaining defects (anonymous `finalise_ready` gating, repair-clearance ordering/validation) were fixed in-place and re-verified deterministically. Protocol set to `routing_required` with `nextAction=manual_handoff_after_fix_routing` and `failedPremiumReviewCount=2`. No third premium review was launched or claimed as passed. Handoff: `docs_private/automation/reviews/ws_0a0f7fc081bc9fad-finalise-handoff.md`.

**Closure note (Workstream 3):** Live read-only schema preflight matched the assumed FK/trigger contract. Independent architecture gate `approved_with_conditions` (`b9e470ec-3173-4fbe-8c6c-e1aaa7c9178f`). Exact-snapshot trusted cleanup registered as `fixerrors-exact-snapshot-v1` after FXERR unit + ephemeral-schema PostgreSQL integration evidence. First premium final-diff review `BLOCKED`; consolidated blocker-family fix applied (strict cleanup CLI, server-identity target fingerprint, dependent-trigger schema fingerprint, export-bound dependency inventory, real PG CONC/TX/DEP/RB coverage). Final premium closure status is recorded in the WS3 handoff after closure protocol.

| Test ID | Owner | Evidence | Status |
|---|---|---|---|
| TEE-PLAN-001 | core | `tests/unit/workflow-plan-contract.test.ts` | passed |
| TEE-PATH-001 | core | `tests/unit/workflow-plan-contract.test.ts`, `tests/unit/workflow-review-protocol.test.ts`, `tests/unit/tee-v2-context.test.ts`, `tests/unit/workflow-review.test.ts` (unsafe generationHash) | passed |
| TEE-MODEL-001 | core | `tests/unit/workflow-plan-contract.test.ts`, `tests/unit/workflow-review.test.ts` | passed |
| TEE-MARKER-001 | core | `tests/unit/workflow-review.test.ts` marker suite | passed |
| TEE-STOP-001 | core | `tests/unit/tee-v2-context.test.ts`, `tests/unit/workflow-review.test.ts` (malformed input, missing tooling, processor failure, timeout fail-open) | passed |
| TEE-PRIV-001 | core | `tests/unit/workflow-review.test.ts` privacy + protocol privacy cases; `tests/unit/workflow-review-protocol.test.ts` command/liveVerification sanitation | passed |
| TEE-EVENT-001 | core | `tests/unit/workflow-review.test.ts` events/lock suite | passed |
| TEE-PROTO-001 | core | `tests/unit/workflow-review-protocol.test.ts` | passed |
| TEE-EVID-001 | core | `tests/unit/workflow-review-protocol.test.ts`, `tests/unit/workflow-plan-contract.test.ts` (child requiredTestIds) | passed |
| TEE-FOLLOWUP-001 | core | `tests/unit/workflow-review.test.ts` workstream lineage + resolver | passed |
| TEE-INDEPENDENCE-001 | core + finalise (`ws_0a0f7fc081bc9fad`) | `tests/unit/tee-v2-context.test.ts`, `tests/unit/finalise-repair.test.ts` (new finalise modules) | passed |
| TEE-DOCS-001 | core (portion) | `scripts/README.md`, `docs/guides/TESTSUITE_AND_AUTOMATION_PARITY.md`, this ledger, command/rule files | passed |
| TEE-FINALISE-001 | finalise (`ws_0a0f7fc081bc9fad`) | `tests/unit/workflow-finalise-correlation.test.ts` | passed |
| TEE-CHECKPOINT-001 | finalise (`ws_0a0f7fc081bc9fad`) | `tests/unit/finalise-recent-tasks.test.ts` | passed |
| TEE-NOLIVE-001 | finalise (`ws_0a0f7fc081bc9fad`) | `tests/unit/finalise-recent-tasks.test.ts` | passed |
| TEE-REPAIR-001 | finalise (`ws_0a0f7fc081bc9fad`) | `tests/unit/finalise-repair.test.ts` | passed |
| TEE-RELEASE-001 | finalise (`ws_0a0f7fc081bc9fad`) | `tests/unit/finalise-release.test.ts` | passed |
| TEE-PUSH-001 | finalise (+ core command surface) | `tests/unit/tee-v2-context.test.ts`, `tests/unit/finalise-repair.test.ts` | passed |
| FXERR-SNAP-001 | fixerrors (`ws_db20217d5f1cd7d2`) | `tests/unit/fixerrors-safety.test.ts` | passed |
| FXERR-CONC-001 | fixerrors (`ws_db20217d5f1cd7d2`) | `tests/unit/fixerrors-safety.test.ts`, `tests/integration/db/fixerrors-safety-pg.test.ts` | passed |
| FXERR-ART-001 | fixerrors (`ws_db20217d5f1cd7d2`) | `tests/unit/fixerrors-safety.test.ts` | passed |
| FXERR-DEL-001 | fixerrors (`ws_db20217d5f1cd7d2`) | `tests/unit/fixerrors-safety.test.ts`, `tests/integration/db/fixerrors-safety-pg.test.ts` | passed |
| FXERR-DEP-001 | fixerrors (`ws_db20217d5f1cd7d2`) | `tests/unit/fixerrors-safety.test.ts`, `tests/integration/db/fixerrors-safety-pg.test.ts` | passed |
| FXERR-TX-001 | fixerrors (`ws_db20217d5f1cd7d2`) | `tests/unit/fixerrors-safety.test.ts`, `tests/integration/db/fixerrors-safety-pg.test.ts` | passed |
| FXERR-RB-001 | fixerrors (`ws_db20217d5f1cd7d2`) | `tests/unit/fixerrors-safety.test.ts`, `tests/integration/db/fixerrors-safety-pg.test.ts` | passed |
| FXERR-SCHEMA-001 | fixerrors (`ws_db20217d5f1cd7d2`) | `tests/unit/fixerrors-safety.test.ts`, `tests/integration/db/fixerrors-safety-pg.test.ts` | passed |
| FXERR-CONFIRM-001 | fixerrors (`ws_db20217d5f1cd7d2`) | `tests/unit/fixerrors-safety.test.ts` (includes strict CLI unknown/duplicate flags) | passed |
| FXERR-TARGET-001 | fixerrors (`ws_db20217d5f1cd7d2`) | `tests/unit/fixerrors-safety.test.ts` (server-identity fingerprint) | passed |
| FXERR-TRUST-001 | fixerrors (`ws_db20217d5f1cd7d2`) | `tests/unit/trusted-operational-actions.test.ts` | passed |
| FXERR-COMPAT-001 | fixerrors (`ws_db20217d5f1cd7d2`) | `tests/unit/trusted-operational-actions.test.ts`, `tests/unit/tee-v2-context.test.ts` | passed |
| FXERR-INDEP-001 | fixerrors (`ws_db20217d5f1cd7d2`) | `tests/unit/fixerrors-safety.test.ts` | passed |
| FXERR-DOCS-001 | fixerrors (`ws_db20217d5f1cd7d2`) | `tests/unit/tee-v2-context.test.ts`, `.cursor/commands/fixerrors.md`, `scripts/README.md`, this ledger | passed |

## Unresolved risks retained

- `R-HOOK-DRIFT`
- `R-MODEL-DRIFT`
- `R-LOCK-RECOVERY`
- `R-PLAN-SCHEMA-BOOTSTRAP`
- `R-FINALISE-MERGE` (Workstream 2; two premium failures → FIX_IN_PLACE; deterministic re-verify in this sweep; no third premium review)
- `R-DB-AVAILABILITY` (Workstream 2; live schema only on db steps)
- `R-FXERR-COMMIT-AMBIGUITY` (Workstream 3; transport loss during COMMIT may require manual DB verification; never auto-retry)
- `R-FXERR-NO-AUTO-RESTORE` (Workstream 3; post-commit restore is manual)
- `R-FXERR-LOCAL-TAMPER` (Workstream 3; checksums are integrity controls, not authorization against a credential holder)
- `R-FXERR-SCHEMA-DRIFT` (Workstream 3; future FK/trigger drift suspends cleanup until reviewed)
- `R-DEBUG-CLEAR-UNTRUSTED` (Workstream 3; Debug UI / `clear-all-error-logs.ts` remain outside trusted scope)
- `R-GLOBAL-SKILL`
- Routing residual (WS1 + WS2): routing delta has deterministic verification only; no third independent premium review (by design after two failed rounds)

Resolved by Workstream 3: `R-FIXERRORS-DEFERRED`.

## Rollback notes

- Core rollback: disable/remove `.cursor/hooks.json` stop-hook integration first, then revert new writers while retaining mixed-version readers.
- Do not rewrite or delete immutable workflow events to manufacture a clean state.
- Global TEE skill rollback is manual and outside this repository.
