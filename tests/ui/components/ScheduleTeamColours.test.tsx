/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScheduleAssignmentTeamMarkers, ScheduleTeamColoursProvider, ScheduleVisitTeamColours, SCHEDULE_TEAM_COLOURS, scheduleTeamColour } from '@/app/(dashboard)/scheduling/components/ScheduleTeamColours';
import { defaultScheduleTeamSettings } from '@/lib/utils/scheduling-day-teams';
import type { ScheduleAssignment, ScheduleDayTeams } from '@/types/scheduling';

const dayTeams: ScheduleDayTeams[] = [{ date: '2026-10-12', slots: [{
  work_date: '2026-10-12', slot_index: 3, members: [{
    work_date: '2026-10-12', slot_index: 3, profile_id: 'person-1', employee: null,
    added_by: null, created_at: '2026-10-12T07:00:00Z',
  }],
}] }];
const assignment = {
  id: 'assignment-1', resource_type: 'employee', profile_id: 'person-1',
  job_id: 'job-1', visit_id: 'visit-1', work_date: '2026-10-12',
} as ScheduleAssignment;
const settings = defaultScheduleTeamSettings();

function View({ assignments = [assignment], teams = dayTeams }: { assignments?: ScheduleAssignment[]; teams?: ScheduleDayTeams[] }) {
  return <ScheduleTeamColoursProvider dayTeams={teams} settings={settings}>
    <ScheduleVisitTeamColours assignments={assignments} jobId="job-1" visitId="visit-1" workDate="2026-10-12" />
    {assignments.map(item => <ScheduleAssignmentTeamMarkers key={item.id} assignment={item} />)}
  </ScheduleTeamColoursProvider>;
}

describe('daily team colour identity', () => {
  it('gives the five default slots distinct, stable colours', () => {
    expect(new Set(SCHEDULE_TEAM_COLOURS.slice(0, 5).map(colour => colour.accent)).size).toBe(5);
    expect(scheduleTeamColour(3).accent).toBe('#a78bfa');
  });
  it('uses the same numbered colour for an assigned employee and their visit', () => {
    render(<View />);
    expect(screen.getByLabelText('Team 3, bucket 3')).toHaveTextContent('3');
    expect(screen.getByLabelText('Team 3, bucket 3')).toHaveStyle({ backgroundColor: '#a78bfa' });
    const rail = screen.getByTestId('schedule-visit-team-colours-visit-1');
    expect(rail).toHaveAttribute('aria-label', 'Team 3, bucket 3: 1 of 1 members assigned');
    expect(rail.querySelector('[data-team-slot="3"]')).toHaveStyle({ backgroundColor: '#a78bfa' });
  });
  it.each([
    { job_id: 'other-job' }, { visit_id: 'other-visit' }, { work_date: '2026-10-13' },
    { resource_type: 'plant' }, { profile_id: 'not-a-member' },
  ])('does not mark the visit from unrelated assignments %j', change => {
    render(<View assignments={[{ ...assignment, ...change } as ScheduleAssignment]} />);
    expect(screen.queryByTestId('schedule-visit-team-colours-visit-1')).not.toBeInTheDocument();
  });
  it('reflects current persisted membership after the board refreshes', () => {
    const { rerender } = render(<View />);
    expect(screen.getByLabelText('Team 3, bucket 3')).toBeInTheDocument();
    rerender(<View teams={[{ date: '2026-10-12', slots: [] }]} />);
    expect(screen.queryByLabelText('Team 3, bucket 3')).not.toBeInTheDocument();
    expect(screen.queryByTestId('schedule-visit-team-colours-visit-1')).not.toBeInTheDocument();
  });
});
