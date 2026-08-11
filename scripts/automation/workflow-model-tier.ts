import type {
  WorkflowLane,
  WorkflowParentTier,
  WorkflowRoutingDecision,
} from './types';

export const WORKFLOW_MODEL_TIER_REGISTRY_VERSION = 'ffts-tee-model-registry-v1';

export type WorkflowModelRoleKey =
  | 'economical-default'
  | 'premium-architecture-gate'
  | 'premium-final-review'
  | 'premium-fix-routing'
  | 'premium-planning';

export type WorkflowModelFamily =
  | 'cursor-grok'
  | 'gpt-sol'
  | 'composer'
  | 'claude'
  | 'unknown';

export interface WorkflowModelRole {
  role: WorkflowModelRoleKey;
  tier: Exclude<WorkflowParentTier, 'unknown'>;
  family: WorkflowModelFamily;
  displayName: string;
  modelIds: string[];
  defaultModelId: string;
}

export interface WorkflowRoutingContext {
  parentTier: WorkflowParentTier;
  /** Legacy fallback when lane is not yet available. */
  risk?: 'high' | 'routine';
  lane?: WorkflowLane;
  substantive: boolean;
  /** STANDARD only: switching is offered only when the implementation is materially large. */
  substantialImplementation?: boolean;
  explicitPremiumRequested: boolean;
  premiumTaskDecision?: 'pause_to_switch' | 'continue_premium';
}

export type WorkflowRoutingAction = 'ask_switch' | 'pause_for_switch' | 'continue';

export interface WorkflowRoutingEvidence {
  initialParentTier: WorkflowParentTier;
  executionParentTier: WorkflowParentTier;
  routingDecision: WorkflowRoutingDecision;
}

/**
 * Exact available FFTS TEE model IDs only.
 * Unrecognized model strings classify as unknown (R-MODEL-DRIFT).
 */
export const WORKFLOW_MODEL_REGISTRY: WorkflowModelRole[] = [
  {
    role: 'economical-default',
    tier: 'economical',
    family: 'cursor-grok',
    displayName: 'Cursor Grok 4.5',
    modelIds: ['cursor-grok-4.5-high-fast', 'composer-2.5-fast'],
    defaultModelId: 'cursor-grok-4.5-high-fast',
  },
  {
    role: 'premium-architecture-gate',
    tier: 'premium',
    family: 'gpt-sol',
    displayName: 'GPT-5.6 Sol (high reasoning)',
    modelIds: ['gpt-5.6-sol-high', 'gpt-5.4-medium'],
    defaultModelId: 'gpt-5.6-sol-high',
  },
  {
    role: 'premium-final-review',
    tier: 'premium',
    family: 'gpt-sol',
    displayName: 'GPT-5.6 Sol (high reasoning)',
    modelIds: ['gpt-5.6-sol-high', 'gpt-5.4-medium'],
    defaultModelId: 'gpt-5.6-sol-high',
  },
  {
    role: 'premium-fix-routing',
    tier: 'premium',
    family: 'gpt-sol',
    displayName: 'GPT-5.6 Sol (high)',
    modelIds: ['gpt-5.6-sol-high'],
    defaultModelId: 'gpt-5.6-sol-high',
  },
  {
    role: 'premium-planning',
    tier: 'premium',
    family: 'gpt-sol',
    displayName: 'GPT-5.6 Sol',
    modelIds: [
      'gpt-5.6-sol-high',
      'gpt-5.4-medium',
      'claude-opus-5-thinking-high',
      'claude-sonnet-5-thinking-high',
      'claude-fable-5-thinking-high',
    ],
    defaultModelId: 'gpt-5.6-sol-high',
  },
];

const PREMIUM_MODEL_IDS = new Set(
  WORKFLOW_MODEL_REGISTRY.filter((role) => role.tier === 'premium').flatMap((role) =>
    role.modelIds.map((id) => id.toLowerCase())
  )
);

const ECONOMICAL_MODEL_IDS = new Set(
  WORKFLOW_MODEL_REGISTRY.filter((role) => role.tier === 'economical').flatMap((role) =>
    role.modelIds.map((id) => id.toLowerCase())
  )
);

const ROLE_BY_KEY = new Map(WORKFLOW_MODEL_REGISTRY.map((role) => [role.role, role]));

export function getWorkflowModelRole(role: string | null | undefined): WorkflowModelRole | null {
  if (!role?.trim()) return null;
  return ROLE_BY_KEY.get(role.trim() as WorkflowModelRoleKey) ?? null;
}

export function resolveWorkflowModelRoleKey(
  model: string | null | undefined
): WorkflowModelRoleKey | 'unknown' {
  if (!model?.trim()) return 'unknown';
  const normalized = model.trim().toLowerCase();
  for (const role of WORKFLOW_MODEL_REGISTRY) {
    if (role.modelIds.some((id) => id.toLowerCase() === normalized)) {
      return role.role;
    }
  }
  return 'unknown';
}

export function classifyWorkflowModelTier(model: string | null | undefined): WorkflowParentTier {
  if (!model?.trim()) return 'unknown';
  const normalized = model.trim().toLowerCase();
  if (PREMIUM_MODEL_IDS.has(normalized)) return 'premium';
  if (ECONOMICAL_MODEL_IDS.has(normalized)) return 'economical';
  return 'unknown';
}

export function getWorkflowRoutingAction(context: WorkflowRoutingContext): WorkflowRoutingAction {
  const economicalSwitchEligible =
    context.lane === 'standard'
      ? context.substantialImplementation === true
      : context.lane
        ? false
        : context.risk === 'routine';
  if (
    !context.substantive ||
    context.parentTier !== 'premium' ||
    !economicalSwitchEligible ||
    context.explicitPremiumRequested
  ) {
    return 'continue';
  }
  if (context.premiumTaskDecision === 'pause_to_switch') return 'pause_for_switch';
  if (context.premiumTaskDecision === 'continue_premium') return 'continue';
  return 'ask_switch';
}

export function isWorkflowRoutingDecisionCoherent(evidence: WorkflowRoutingEvidence): boolean {
  switch (evidence.routingDecision) {
    case 'switched_to_economical':
      return evidence.initialParentTier === 'premium' && evidence.executionParentTier === 'economical';
    case 'continued_premium':
    case 'explicit_premium':
      return evidence.initialParentTier === 'premium' && evidence.executionParentTier === 'premium';
    case 'economical_default':
      return evidence.initialParentTier === 'economical' && evidence.executionParentTier === 'economical';
    case 'not_applicable':
      return evidence.initialParentTier === 'unknown' && evidence.executionParentTier === 'unknown';
    case 'unknown':
      return evidence.initialParentTier === 'unknown' || evidence.executionParentTier === 'unknown';
  }
}
