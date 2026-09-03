# CRITICAL generated wording (TEE V2.4)

Use these sentences in generated CRITICAL / high-risk plan contracts, implementation-contract boundaries, reviewer templates, and finalise command notes.

## Required boundary

Do not launch a third premium review for the same CRITICAL continuation. Routing or split does not reset this budget.

## Required split / ownership qualifier

The active descendant owns remaining work. After two failed premium rounds, remaining work is routing, isolation, or proven removal from release — not another normal final-diff pass. A split child inherits the lineage-scoped budget and must not re-enter `initialized` / preflight to mint a new `first` review.

## Forbidden V2.3 phrases

Do not emit:

- Do not launch a third premium review without routing or split.
- After two failed premium rounds route/split instead of reviewing again.
- The active descendant owns remaining review/finalise.

unless the V2.4 qualifier above is present in the same contract.

## Exhausted state

After two failed premium rounds the lineage is `routing_required`. That state is terminal for the normal review loop and is not `finalised`, `review_closed`, or `finalise_ready`.
