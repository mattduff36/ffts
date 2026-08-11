# TEE V2.2 Verification Ledger (FFTS)

Master workstream: `ws_5a7b2d5716a10c27`  
Core workstream: `ws_8670b5ee93738ff1`  
Architecture gate: `approved_with_conditions` (`255309b1-9c98-4383-934a-832aef8d63c6`)

Statuses below reflect Workstream 1 deterministic verification evidence. Missing/stale evidence remains `unknown`, never passed.

**Closure note (Workstream 1):** Two independent premium final-diff review rounds both `BLOCKED`. Premium fix-routing chose `FIX_IN_PLACE`; routed fixes were applied and re-verified deterministically. Protocol moved to `routing_required` for manual handoff. No third premium review was launched or claimed as passed. Finalise-owned IDs remain unresolved pending Workstream 2.

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
| TEE-INDEPENDENCE-001 | core | `tests/unit/tee-v2-context.test.ts` | passed |
| TEE-DOCS-001 | core (portion) | `scripts/README.md`, `docs/guides/TESTSUITE_AND_AUTOMATION_PARITY.md`, this ledger, command/rule files | passed |
| TEE-FINALISE-001 | finalise | deferred to `ws_0a0f7fc081bc9fad` | unresolved |
| TEE-CHECKPOINT-001 | finalise | deferred to `ws_0a0f7fc081bc9fad` | unresolved |
| TEE-NOLIVE-001 | finalise | deferred to `ws_0a0f7fc081bc9fad` | unresolved |
| TEE-REPAIR-001 | finalise | deferred to `ws_0a0f7fc081bc9fad` | unresolved |
| TEE-RELEASE-001 | finalise | deferred to `ws_0a0f7fc081bc9fad` | unresolved |
| TEE-PUSH-001 | finalise (+ core command surface) | core command absence covered now; finalise wiring deferred | partial |

## Unresolved risks retained

- `R-HOOK-DRIFT`
- `R-MODEL-DRIFT`
- `R-LOCK-RECOVERY`
- `R-PLAN-SCHEMA-BOOTSTRAP`
- `R-FINALISE-MERGE` (Workstream 2; not started)
- `R-DB-AVAILABILITY` (Workstream 2; not started)
- `R-FIXERRORS-DEFERRED` (Workstream 3; not started)
- `R-GLOBAL-SKILL`
- Routing residual: routing delta has deterministic verification only; no third independent premium review (by design after two failed rounds)

## Rollback notes

- Core rollback: disable/remove `.cursor/hooks.json` stop-hook integration first, then revert new writers while retaining mixed-version readers.
- Do not rewrite or delete immutable workflow events to manufacture a clean state.
- Global TEE skill rollback is manual and outside this repository.
