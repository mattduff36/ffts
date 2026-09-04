import type {
  ScheduleAssignment,
  ScheduleDayCapacity,
  ScheduleJob,
  ScheduleJobTag,
  SchedulePlantUnavailability,
  ScheduleProjectCandidate,
  ScheduleQuoteCandidate,
  ScheduleVisit,
  ScheduleVisitBacklogItem,
  ScheduleVisitBacklogPreview,
  EnqueueScheduleVisitResult,
  ScheduleQueuedVisitResult,
  ScheduleTeamSettings,
  SchedulingBoardPayload,
  SchedulingConflict,
  SchedulingContext,
  SchedulingSelfPayload,
} from '@/types/scheduling';

export class SchedulingApiError extends Error {
  status: number;
  payload: Record<string, unknown>;

  constructor(message: string, status: number, payload: Record<string, unknown>) {
    super(message);
    this.name = 'SchedulingApiError';
    this.status = status;
    this.payload = payload;
  }
}

async function readResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new SchedulingApiError(
      typeof payload.error === 'string' ? payload.error : 'Scheduling request failed.',
      response.status,
      payload
    );
  }
  return payload as T;
}

function assertNoProvisionalIds(
  value: unknown,
  path = 'scheduling mutation'
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoProvisionalIds(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const itemPath = `${path}.${key}`;
    const isIdentityField =
      key === 'id'
      || key === 'tag_ids'
      || key === 'resource_id'
      || key.endsWith('_id');
    if (isIdentityField && typeof item === 'string' && item.startsWith('optimistic:')) {
      throw new Error(`Wait for ${itemPath} to finish saving.`);
    }
    if (isIdentityField && Array.isArray(item)) {
      for (const id of item) {
        if (typeof id === 'string' && id.startsWith('optimistic:')) {
          throw new Error(`Wait for ${itemPath} to finish saving.`);
        }
      }
    }
    if (item && typeof item === 'object') assertNoProvisionalIds(item, itemPath);
  }
}

export async function fetchSchedulingContext(): Promise<SchedulingContext> {
  return readResponse(await fetch('/api/scheduling/context'));
}

export async function fetchSchedulingBoard(weekStart: string): Promise<SchedulingBoardPayload> {
  return readResponse(
    await fetch(`/api/scheduling/board?week_start=${encodeURIComponent(weekStart)}`)
  );
}

export async function fetchMySchedule(weekStart: string): Promise<SchedulingSelfPayload> {
  return readResponse(
    await fetch(`/api/scheduling/me?week_start=${encodeURIComponent(weekStart)}`)
  );
}

export async function saveScheduleJob(
  input: Partial<ScheduleJob>
    & { tag_ids?: string[] },
  id?: string
): Promise<ScheduleJob> {
  assertNoProvisionalIds({ id, ...input });
  const response = await fetch(id ? `/api/scheduling/jobs/${id}` : '/api/scheduling/jobs', {
    method: id ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return (await readResponse<{ job: ScheduleJob }>(response)).job;
}

export interface CreateProjectScheduleJobInput {
  project_number_id?: string | null;
  manager_profile_id?: string | null;
  project_title?: string | null;
  project_description?: string | null;
  project_notes?: string | null;
  customer_id: string;
  customer_site_id?: string | null;
  site_address?: string | null;
  status: ScheduleJob['status'];
  start_date: string;
  end_date: string;
  estimated_duration_minutes?: number | null;
  is_drop_on_ready: boolean;
  tag_ids: string[];
  initial_visit?: {
    starts_at: string;
    ends_at: string;
  };
}

export interface ScheduleJobMutationResult {
  job: ScheduleJob;
  visit?: ScheduleVisit;
}

export async function createProjectScheduleJob(
  input: CreateProjectScheduleJobInput
): Promise<ScheduleJobMutationResult> {
  assertNoProvisionalIds(input);
  const response = await fetch('/api/scheduling/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readResponse<ScheduleJobMutationResult>(response);
}

export interface QuickAddScheduleProjectInput {
  request_id: string;
  manager_profile_id: string;
  project_title: string;
  project_description?: string | null;
  project_notes?: string | null;
  customer_id: string;
  customer_site_id?: string | null;
  site_address?: string | null;
  start_date: string;
  end_date?: string;
  estimated_duration_minutes?: number | null;
  is_drop_on_ready?: boolean;
  tag_ids?: string[];
  initial_visit: {
    starts_at: string;
    ends_at: string;
  };
}

export interface QuickAddScheduleProjectResult {
  job: ScheduleJob;
  visit: ScheduleVisit;
  project_number_id: string;
  project_reference: string;
  was_project_created: boolean;
}

export async function quickAddScheduleProject(
  input: QuickAddScheduleProjectInput
): Promise<QuickAddScheduleProjectResult> {
  assertNoProvisionalIds(input);
  const response = await fetch('/api/scheduling/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'quick_add',
      status: 'scheduled',
      is_drop_on_ready: false,
      tag_ids: [],
      ...input,
    }),
  });
  return readResponse<QuickAddScheduleProjectResult>(response);
}

export interface AssignmentMutationRow {
  id: string;
  job_id: string;
  work_date: string;
  visit_id: string | null;
  notes: string | null;
  conflict_override: boolean;
  conflict_codes: ScheduleAssignment['conflict_codes'];
  conflict_override_by: string | null;
  conflict_override_at: string | null;
  assigned_by: string | null;
  created_at: string;
  updated_at: string;
  resource_type: 'employee' | 'plant';
  profile_id?: string | null;
  plant_id?: string | null;
}

export interface AssignmentMutationResult {
  assignments?: AssignmentMutationRow[];
  assignment?: AssignmentMutationRow;
  employee_capacity?: ScheduleDayCapacity[];
  success?: boolean;
}

export async function createScheduleJobTag(input: {
  name: string;
  color?: string;
  description?: string | null;
}): Promise<ScheduleJobTag> {
  assertNoProvisionalIds(input);
  const response = await fetch('/api/scheduling/tags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return (await readResponse<{ tag: ScheduleJobTag }>(response)).tag;
}

export interface DeleteScheduleJobResult {
  success: true;
  source_type: ScheduleJob['source_type'];
  quote_id: string | null;
  project_number_id: string | null;
}

export async function deleteScheduleJob(id: string): Promise<DeleteScheduleJobResult> {
  assertNoProvisionalIds({ id });
  return readResponse(
    await fetch(`/api/scheduling/jobs/${id}`, { method: 'DELETE' })
  );
}

export async function fetchScheduleQuoteCandidates(): Promise<ScheduleQuoteCandidate[]> {
  const payload = await readResponse<{ quotes: ScheduleQuoteCandidate[] }>(
    await fetch('/api/scheduling/quotes')
  );
  return payload.quotes;
}

export async function fetchScheduleProjectCandidates(): Promise<ScheduleProjectCandidate[]> {
  const payload = await readResponse<{ projects: ScheduleProjectCandidate[] }>(
    await fetch('/api/scheduling/projects')
  );
  return payload.projects;
}

export async function fetchScheduleVisitBacklog(): Promise<ScheduleVisitBacklogItem[]> {
  const payload = await readResponse<{ items: ScheduleVisitBacklogItem[] }>(
    await fetch('/api/scheduling/visit-backlog')
  );
  return payload.items;
}

export async function previewScheduleVisitBacklog(
  visitId: string
): Promise<ScheduleVisitBacklogPreview> {
  assertNoProvisionalIds({ visit_id: visitId });
  const payload = await readResponse<{ preview: ScheduleVisitBacklogPreview }>(
    await fetch(`/api/scheduling/visits/${visitId}/backlog`)
  );
  return payload.preview;
}

export async function enqueueScheduleVisit(input: {
  request_id: string;
  visit_id: string;
  expected_fingerprint: string;
}): Promise<EnqueueScheduleVisitResult> {
  assertNoProvisionalIds(input);
  const payload = await readResponse<{ transition: EnqueueScheduleVisitResult }>(
    await fetch(`/api/scheduling/visits/${input.visit_id}/backlog`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request_id: input.request_id,
        expected_fingerprint: input.expected_fingerprint,
      }),
    })
  );
  return payload.transition;
}

export async function scheduleQueuedVisit(input: {
  request_id: string;
  visit_id: string;
  starts_at: string;
}): Promise<ScheduleQueuedVisitResult> {
  assertNoProvisionalIds(input);
  return readResponse(
    await fetch(`/api/scheduling/visit-backlog/${input.visit_id}/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request_id: input.request_id,
        starts_at: input.starts_at,
      }),
    })
  );
}

export interface ScheduleQuoteInput {
  quote_id: string;
  start_date: string;
  end_date: string;
  initial_visit?: {
    starts_at: string;
    ends_at: string;
  };
}

export async function saveQuoteSchedule(
  input: ScheduleQuoteInput
): Promise<ScheduleJobMutationResult> {
  assertNoProvisionalIds(input);
  const response = await fetch('/api/scheduling/quotes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readResponse<ScheduleJobMutationResult>(response);
}

export interface CreateAssignmentInput {
  job_id: string;
  visit_id?: string;
  resource_type: 'employee' | 'plant';
  resource_id: string;
  work_dates?: string[];
  notes?: string | null;
  override_conflicts?: boolean;
  request_id?: string;
}

async function maybeDelaySchedulingMutation() {
  if (process.env.NODE_ENV !== 'development') return;
  const raw = process.env.NEXT_PUBLIC_SCHEDULING_MUTATION_DELAY_MS;
  const delayMs = raw ? Number(raw) : 0;
  if (!Number.isFinite(delayMs) || delayMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

export interface SaveScheduleVisitInput {
  job_id: string;
  title?: string | null;
  starts_at: string;
  ends_at: string;
  status?: 'planned' | 'completed' | 'cancelled';
  notes?: string | null;
}

export async function saveScheduleVisit(
  input: SaveScheduleVisitInput,
  id?: string
): Promise<ScheduleVisit> {
  assertNoProvisionalIds({ id, ...input });
  const response = await fetch(
    id ? `/api/scheduling/visits/${id}` : '/api/scheduling/visits',
    {
      method: id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }
  );
  return (await readResponse<{ visit: ScheduleVisit }>(response)).visit;
}

export async function deleteScheduleVisit(id: string): Promise<void> {
  assertNoProvisionalIds({ id });
  await readResponse(await fetch(`/api/scheduling/visits/${id}`, { method: 'DELETE' }));
}

export async function createScheduleAssignment(
  input: CreateAssignmentInput
): Promise<AssignmentMutationResult> {
  const payload = {
    ...input,
    request_id: input.request_id || crypto.randomUUID(),
  };
  assertNoProvisionalIds(payload);
  await maybeDelaySchedulingMutation();
  return readResponse(
    await fetch('/api/scheduling/assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  );
}

export async function addScheduleDayTeamMember(input: {
  work_date: string;
  slot_index: number;
  profile_id: string;
}): Promise<{ member: Record<string, unknown> }> {
  assertNoProvisionalIds(input);
  return readResponse(
    await fetch('/api/scheduling/day-teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  );
}

export async function removeScheduleDayTeamMember(input: {
  work_date: string;
  slot_index: number;
  profile_id: string;
}): Promise<{ success: boolean }> {
  assertNoProvisionalIds(input);
  const params = new URLSearchParams({
    work_date: input.work_date,
    slot_index: String(input.slot_index),
    profile_id: input.profile_id,
  });
  return readResponse(
    await fetch(`/api/scheduling/day-teams?${params.toString()}`, {
      method: 'DELETE',
    })
  );
}

export interface DayTeamAssignSkippedMember {
  profile_id: string;
  full_name: string;
  reason: 'conflict' | 'overlap';
  conflicts: SchedulingConflict[];
}

export interface DayTeamAssignResult {
  assignments: AssignmentMutationRow[];
  skipped: DayTeamAssignSkippedMember[];
  already_assigned_count: number;
  employee_capacity?: ScheduleDayCapacity[];
  error?: string;
  partial?: boolean;
}

export async function saveScheduleTeamSettings(input: {
  visible_slot_count: number;
  leaders: Array<{ slot_index: number; profile_id: string | null }>;
}): Promise<{ settings: ScheduleTeamSettings }> {
  return readResponse(
    await fetch('/api/scheduling/team-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  );
}

export async function assignScheduleDayTeam(input: {
  visit_id: string;
  slot_index: number;
  member_request_ids?: Record<string, string>;
}): Promise<DayTeamAssignResult> {
  assertNoProvisionalIds(input);
  await maybeDelaySchedulingMutation();
  return readResponse(
    await fetch('/api/scheduling/assignments/team', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  );
}

export async function moveScheduleAssignment(
  assignment: Pick<ScheduleAssignment, 'id' | 'resource_type'>,
  visitId: string,
  overrideConflicts = false,
  requestId?: string
): Promise<AssignmentMutationResult> {
  assertNoProvisionalIds({ assignment_id: assignment.id, visit_id: visitId });
  await maybeDelaySchedulingMutation();
  return readResponse(
    await fetch(`/api/scheduling/assignments/${assignment.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resource_type: assignment.resource_type,
        visit_id: visitId,
        override_conflicts: overrideConflicts,
        request_id: requestId || crypto.randomUUID(),
      }),
    })
  );
}

export async function deleteScheduleAssignment(
  id: string,
  resourceType: 'employee' | 'plant',
  requestId?: string
): Promise<AssignmentMutationResult> {
  assertNoProvisionalIds({ id });
  await maybeDelaySchedulingMutation();
  const params = new URLSearchParams({
    resource_type: resourceType,
    request_id: requestId || crypto.randomUUID(),
  });
  return readResponse(
    await fetch(`/api/scheduling/assignments/${id}?${params.toString()}`, {
      method: 'DELETE',
    })
  );
}

export interface SavePlantUnavailabilityInput {
  plant_id: string;
  start_date: string;
  end_date: string;
  reason: string;
  notes?: string | null;
}

export async function savePlantUnavailability(
  input: SavePlantUnavailabilityInput
): Promise<SchedulePlantUnavailability> {
  assertNoProvisionalIds(input);
  const payload = await readResponse<{ block: SchedulePlantUnavailability }>(
    await fetch('/api/scheduling/plant-unavailability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  );
  return payload.block;
}

export async function deletePlantUnavailability(id: string): Promise<void> {
  assertNoProvisionalIds({ id });
  await readResponse(
    await fetch(`/api/scheduling/plant-unavailability/${id}`, { method: 'DELETE' })
  );
}
