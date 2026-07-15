import type {
  ScheduleJob,
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
  input: Partial<ScheduleJob> & Pick<ScheduleJob, 'job_reference' | 'title' | 'start_date' | 'end_date'>,
  id?: string
): Promise<ScheduleJob> {
  const response = await fetch(id ? `/api/scheduling/jobs/${id}` : '/api/scheduling/jobs', {
    method: id ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return (await readResponse<{ job: ScheduleJob }>(response)).job;
}

export async function deleteScheduleJob(id: string): Promise<void> {
  await readResponse(await fetch(`/api/scheduling/jobs/${id}`, { method: 'DELETE' }));
}

export interface CreateAssignmentInput {
  job_id: string;
  resource_type: 'employee' | 'plant';
  resource_id: string;
  work_dates: string[];
  notes?: string | null;
  override_conflicts?: boolean;
}

export async function createScheduleAssignment(input: CreateAssignmentInput): Promise<void> {
  await readResponse(
    await fetch('/api/scheduling/assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  );
}

export async function deleteScheduleAssignment(
  id: string,
  resourceType: 'employee' | 'plant'
): Promise<void> {
  await readResponse(
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
