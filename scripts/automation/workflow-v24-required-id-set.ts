import { loadCanonicalV24RequiredTestIds } from './workflow-verification-ledger';

export const ARCHITECTURE_REQUIRED_IDS = [
  'ARCH-C9-LIVE-CONTEXT-001',
  'ARCH-C9-LIVE-CONTEXT-LOSS-002',
  'ARCH-C9-ACTIVE-LEASE-003',
  'ARCH-GIT-ISOLATION-004',
  'ARCH-TRANSFER-EQUIVALENCE-005',
  'ARCH-VERIFY-BINDING-006',
  'ARCH-C9-PUSH-BINDING-007',
  'ARCH-C9-PUSH-DRIFT-008',
  'ARCH-C9-PUSH-LEASE-009',
  'ARCH-V24-REGRESSION-010',
] as const;

export const FIRST_REVIEW_BLOCKER_IDS = [
  'FDR-CRITICAL-CONTRACT-001',
  'FDR-EVIDENCE-BINDING-002',
  'FDR-REVIEW-AUTHORITY-003',
  'FDR-PROTOCOL-INTEGRITY-004',
] as const;

export const FIX_SWEEP_REQUIRED_IDS = [...FIRST_REVIEW_BLOCKER_IDS] as const;

export const CLOSURE_REQUIRED_IDS = [
  'FDR-CLOSURE-REQUIRED-IDS-001',
  'FDR-PROTOCOL-RECORD-VALIDATION-002',
  'FDR-VERIFY-TYPECHECK-LINT-003',
  'FDR-REVIEW-READINESS-001',
  'FDR-AUTH-INHERITED-FIRST-001',
  'FDR-AUTH-INHERITED-EXHAUSTED-002',
  'FDR-AUTH-CASES-A-F-003',
] as const;

export const TYPECHECK_LINT_REQUIRED_IDS = ['T-TYPECHECK', 'T-LINT'] as const;

const FAMILY_IDS = [
  ...ARCHITECTURE_REQUIRED_IDS,
  ...FIRST_REVIEW_BLOCKER_IDS,
  ...FIX_SWEEP_REQUIRED_IDS,
  ...CLOSURE_REQUIRED_IDS,
  ...TYPECHECK_LINT_REQUIRED_IDS,
] as const;

function normalizeId(id: string): string {
  return id.trim();
}

function isPayableSkip(id: string): boolean {
  return id.startsWith('WF-PAY-');
}

/**
 * The only required-ID constructor for a V2.4 review candidate.
 * Always the sorted union of the canonical manifest, architecture,
 * first-review, fix-sweep, closure, typecheck/lint, and plan IDs.
 * No caller may substitute a weaker list.
 */
export function resolveCanonicalReviewRequiredIds(
  planRequiredIds: readonly string[] = []
): string[] {
  const union = new Set<string>([
    ...loadCanonicalV24RequiredTestIds(),
    ...FAMILY_IDS,
    ...planRequiredIds.map(normalizeId).filter((id) => id && !isPayableSkip(id)),
  ]);
  return [...union].sort();
}

export function assertCanonicalRequiredIdsProven(params: {
  provenIds: readonly string[];
  planRequiredIds?: readonly string[];
}):
  | { ok: true; requiredIds: string[] }
  | { ok: false; missing: string[]; message: string } {
  const requiredIds = resolveCanonicalReviewRequiredIds(params.planRequiredIds);
  const proven = new Set(params.provenIds);
  const missing = requiredIds.filter((id) => !proven.has(id));
  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      message: `required-ID set incomplete: ${missing.join(', ')}`,
    };
  }
  return { ok: true, requiredIds };
}

export function requiredIdFamilyMembers(): {
  architecture: string[];
  firstReview: string[];
  fixSweep: string[];
  closure: string[];
} {
  return {
    architecture: [...ARCHITECTURE_REQUIRED_IDS],
    firstReview: [...FIRST_REVIEW_BLOCKER_IDS],
    fixSweep: [...FIX_SWEEP_REQUIRED_IDS],
    closure: [...CLOSURE_REQUIRED_IDS],
  };
}
