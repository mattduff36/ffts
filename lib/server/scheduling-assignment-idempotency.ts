import 'server-only';
import { createHash } from 'crypto';

export function isMissingScheduleRpc(error: unknown): boolean {
  const value = error as { code?: string; message?: string } | null;
  const message = (value?.message || '').toLowerCase();
  return (
    value?.code === 'PGRST202'
    || value?.code === '42883'
    || message.includes('schema cache')
    || message.includes('could not find the function')
    || (message.includes('function') && message.includes('does not exist'))
  );
}

type RpcResult<T> = {
  data: T;
  error: { code?: string; message?: string } | null;
};

type RpcClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>
  ) => PromiseLike<RpcResult<unknown>>;
};

export async function rpcWithIdempotentFallback<T>(
  admin: RpcClient,
  v2Name: string,
  v2Args: Record<string, unknown>,
  v1Name: string,
  v1Args: Record<string, unknown>
): Promise<RpcResult<T>> {
  const first = await admin.rpc(v2Name, v2Args);
  if (!first.error || !isMissingScheduleRpc(first.error)) {
    return first as RpcResult<T>;
  }
  return (await admin.rpc(v1Name, v1Args)) as RpcResult<T>;
}

function md5Pipe(parts: string[]): string {
  return createHash('md5').update(parts.join('|')).digest('hex');
}

export function assignmentCreateInputHash(input: {
  jobId: string;
  visitId: string | null;
  resourceType: string;
  resourceId: string;
  workDate: string;
  notes?: string | null;
  overrideConflicts: boolean;
}): string {
  return md5Pipe([
    'create',
    input.jobId,
    input.visitId || '',
    input.resourceType,
    input.resourceId,
    input.workDate,
    input.notes || '',
    String(input.overrideConflicts),
  ]);
}

export function assignmentCreateBulkInputHash(input: {
  jobId: string;
  visitId: string | null;
  resourceType: string;
  resourceId: string;
  workDates: string[];
  notes?: string | null;
  overrideConflicts: boolean;
}): string {
  return md5Pipe([
    'create_bulk',
    input.jobId,
    input.visitId || '',
    input.resourceType,
    input.resourceId,
    input.workDates.join(','),
    input.notes || '',
    String(input.overrideConflicts),
  ]);
}

export function assignmentMoveInputHash(input: {
  assignmentId: string;
  resourceType: string;
  visitId: string;
  overrideConflicts: boolean;
}): string {
  return md5Pipe([
    'move',
    input.assignmentId,
    input.resourceType,
    input.visitId,
    String(input.overrideConflicts),
  ]);
}

export type AssignmentRequestReplay<T> =
  | { kind: 'miss' }
  | { kind: 'unavailable' }
  | { kind: 'reused' }
  | { kind: 'replay'; result: T };

export async function replayAssignmentMutationIfPresent<T>(
  admin: RpcClient,
  requestId: string,
  action: 'create' | 'create_bulk' | 'move' | 'delete',
  inputHash: string
): Promise<AssignmentRequestReplay<T>> {
  const { data, error } = await admin.rpc('schedule_assignment_request_replay_v2', {
    p_request_id: requestId,
    p_action: action,
    p_input_hash: inputHash,
  });
  if (error && isMissingScheduleRpc(error)) return { kind: 'unavailable' };
  if (error?.message?.includes('REQUEST_ID_REUSED')) return { kind: 'reused' };
  if (error) {
    throw error;
  }
  if (data == null) return { kind: 'miss' };
  return { kind: 'replay', result: data as T };
}
