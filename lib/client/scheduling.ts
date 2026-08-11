import type {
  ScheduleAssignment,
  ScheduleDayCapacity,
  ScheduleJob,
  ScheduleJobTag,
  ScheduleProjectCandidate,
  ScheduleQuoteCandidate,
  ScheduleVisit,
  ScheduleVisitBacklogItem,
  ScheduleVisitBacklogPreview,
  EnqueueScheduleVisitResult,
  ScheduleQueuedVisitResult,
  SchedulingBoardPayload,
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

export async function createProjectScheduleJob(
  input: CreateProjectScheduleJobInput
): Promise<ScheduleJob> {
  const response = await fetch('/api/scheduling/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return (await readResponse<{ job: ScheduleJob }>(response)).job;
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

export interface AssignmentMutationResult {
  assignments?: Array<Record<string, unknown>>;
  assignment?: Record<string, unknown>;
  employee_capacity?: ScheduleDayCapacity[];
  success?: boolean;
}

export async function createScheduleJobTag(input: {
  name: string;
  color?: string;
  description?: string | null;
}): Promise<ScheduleJobTag> {
  const response = await fetch('/api/scheduling/tags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return (await readResponse<{ tag: ScheduleJobTag }>(response)).tag;
}

export async function deleteScheduleJob(id: string): Promise<void> {
  await readResponse(await fetch(`/api/scheduling/jobs/${id}`, { method: 'DELETE' }));
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

export async function saveQuoteSchedule(input: {
  quote_id: string;
  start_date: string;
  end_date: string;
  initial_visit?: {
    starts_at: string;
    ends_at: string;
  };
}): Promise<ScheduleJob> {
  const response = await fetch('/api/scheduling/quotes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return (await readResponse<{ job: ScheduleJob }>(response)).job;
}

export interface CreateAssignmentInput {
  job_id: string;
  visit_id?: string;
  resource_type: 'employee' | 'plant';
  resource_id: string;
  work_dates?: string[];
  notes?: string | null;
  override_conflicts?: boolean;
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
  await readResponse(await fetch(`/api/scheduling/visits/${id}`, { method: 'DELETE' }));
}

export async function createScheduleAssignment(
  input: CreateAssignmentInput
): Promise<AssignmentMutationResult> {
  return readResponse(
    await fetch('/api/scheduling/assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  );
}

export async function moveScheduleAssignment(
  assignment: Pick<ScheduleAssignment, 'id' | 'resource_type'>,
  visitId: string,
  overrideConflicts = false
): Promise<AssignmentMutationResult> {
  return readResponse(
    await fetch(`/api/scheduling/assignments/${assignment.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resource_type: assignment.resource_type,
        visit_id: visitId,
        override_conflicts: overrideConflicts,
      }),
    })
  );
}

export async function deleteScheduleAssignment(
  id: string,
  resourceType: 'employee' | 'plant'
): Promise<AssignmentMutationResult> {
  return readResponse(
    await fetch(
      `/api/scheduling/assignments/${id}?resource_type=${encodeURIComponent(resourceType)}`,
      { method: 'DELETE' }
    )
  );
}

export async function savePlantUnavailability(input: {
  plant_id: string;
  start_date: string;
  end_date: string;
  reason: string;
  notes?: string | null;
}): Promise<void> {
  await readResponse(
    await fetch('/api/scheduling/plant-unavailability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  );
}

export async function deletePlantUnavailability(id: string): Promise<void> {
  await readResponse(
    await fetch(`/api/scheduling/plant-unavailability/${id}`, { method: 'DELETE' })
  );
}
