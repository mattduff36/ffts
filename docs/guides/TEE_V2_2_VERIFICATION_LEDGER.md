# TEE V2.2 Verification Ledger (FFTS)

Master workstream: `ws_5a7b2d5716a10c27`  
Core workstream: `ws_8670b5ee93738ff1`  
Finalise workstream: `ws_0a0f7fc081bc9fad`  
Architecture gate: `approved_with_conditions` (`255309b1-9c98-4383-934a-832aef8d63c6`)

Statuses below reflect deterministic verification evidence. Missing/stale evidence remains `unknown`, never passed.

**Closure note (Workstream 1):** Two independent premium final-diff review rounds both `BLOCKED`. Premium fix-routing chose `FIX_IN_PLACE`; routed fixes were applied and re-verified deterministically. Protocol moved to `routing_required` for manual handoff. No third premium review was launched or claimed as passed.

**Closure note (Workstream 2):** Two independent premium final-diff review rounds both `BLOCKED`. Premium fix-routing chose `FIX_IN_PLACE`; remaining defects (anonymous `finalise_ready` gating, repair-clearance ordering/validation) were fixed in-place and re-verified deterministically. Protocol set to `routing_required` with `nextAction=manual_handoff_after_fix_routing` and `failedPremiumReviewCount=2`. No third premium review was launched or claimed as passed. Handoff: `docs_private/automation/reviews/ws_0a0f7fc081bc9fad-finalise-handoff.md`.

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

## Unresolved risks retained

- `R-HOOK-DRIFT`
- `R-MODEL-DRIFT`
- `R-LOCK-RECOVERY`
- `R-PLAN-SCHEMA-BOOTSTRAP`
- `R-FINALISE-MERGE` (Workstream 2; two premium failures → FIX_IN_PLACE; deterministic re-verify in this sweep; no third premium review)
- `R-DB-AVAILABILITY` (Workstream 2; live schema only on db steps)
- `R-FIXERRORS-DEFERRED` (Workstream 3; not started)
- `R-GLOBAL-SKILL`
- Routing residual (WS1 + WS2): routing delta has deterministic verification only; no third independent premium review (by design after two failed rounds)

## Rollback notes

- Core rollback: disable/remove `.cursor/hooks.json` stop-hook integration first, then revert new writers while retaining mixed-version readers.
- Do not rewrite or delete immutable workflow events to manufacture a clean state.
- Global TEE skill rollback is manual and outside this repository.
