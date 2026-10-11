'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { resolveScheduleDayTeamName, slotsForScheduleDate } from '@/lib/utils/scheduling-day-teams';
import type { ScheduleAssignment, ScheduleDayTeamSlot, ScheduleDayTeams, ScheduleTeamSettings } from '@/types/scheduling';

// Slot colours are stable across dates; occupancy and conflict colours remain separate.
export const SCHEDULE_TEAM_COLOURS = [
  { accent: '#60a5fa', tint: 'border border-blue-400/70 bg-blue-950/60 text-blue-50' },
  { accent: '#fb923c', tint: 'border border-orange-400/70 bg-orange-950/60 text-orange-50' },
  { accent: '#a78bfa', tint: 'border border-violet-400/70 bg-violet-950/60 text-violet-50' },
  { accent: '#f472b6', tint: 'border border-pink-400/70 bg-pink-950/60 text-pink-50' },
  { accent: '#facc15', tint: 'border border-yellow-400/70 bg-yellow-950/60 text-yellow-50' },
  { accent: '#2dd4bf', tint: 'border border-teal-400/70 bg-teal-950/60 text-teal-50' },
  { accent: '#a3e635', tint: 'border border-lime-400/70 bg-lime-950/60 text-lime-50' },
  { accent: '#f87171', tint: 'border border-red-400/70 bg-red-950/60 text-red-50' },
  { accent: '#22d3ee', tint: 'border border-cyan-400/70 bg-cyan-950/60 text-cyan-50' },
  { accent: '#cbd5e1', tint: 'border border-slate-400/70 bg-slate-800/60 text-slate-50' },
] as const;

export function scheduleTeamColour(slotIndex: number) {
  return SCHEDULE_TEAM_COLOURS[slotIndex - 1] || SCHEDULE_TEAM_COLOURS[0];
}

interface TeamIdentity { slot: ScheduleDayTeamSlot; name: string }
const TeamColoursContext = createContext<ReadonlyMap<string, TeamIdentity[]>>(new Map());

export function ScheduleTeamColoursProvider({ dayTeams, settings, children }: {
  dayTeams: ScheduleDayTeams[];
  settings: ScheduleTeamSettings;
  children: ReactNode;
}) {
  const teamsByDate = useMemo(() => new Map(dayTeams.map(({ date }) => [
    date,
    slotsForScheduleDate(dayTeams, date, settings).map(slot => ({
      slot, name: resolveScheduleDayTeamName(slot, settings),
    })),
  ])), [dayTeams, settings]);
  return <TeamColoursContext.Provider value={teamsByDate}>{children}</TeamColoursContext.Provider>;
}

export function ScheduleAssignmentTeamMarkers({ assignment }: { assignment: ScheduleAssignment }) {
  const teams = useContext(TeamColoursContext).get(assignment.work_date) || [];
  if (assignment.resource_type !== 'employee') return null;
  return teams.filter(({ slot }) => slot.members.some(member => member.profile_id === assignment.profile_id))
    .map(({ slot, name }) => (
      <span key={slot.slot_index}
        className="inline-flex h-3.5 min-w-3.5 shrink-0 items-center justify-center rounded-sm px-0.5 text-[9px] font-bold leading-none text-slate-950"
        style={{ backgroundColor: scheduleTeamColour(slot.slot_index).accent }}
        title={`${name} · bucket ${slot.slot_index} on ${assignment.work_date}`}
        aria-label={`${name}, bucket ${slot.slot_index}`}
        data-team-slot={slot.slot_index}>
        {slot.slot_index}
      </span>
    ));
}

export function ScheduleVisitTeamColours({ assignments, jobId, visitId, workDate }: {
  assignments: ScheduleAssignment[]; jobId: string; visitId: string; workDate: string;
}) {
  const teams = useContext(TeamColoursContext).get(workDate) || [];
  const assigned = new Set(assignments.filter(assignment =>
    assignment.resource_type === 'employee' && assignment.job_id === jobId
    && assignment.visit_id === visitId && assignment.work_date === workDate
  ).map(assignment => assignment.resource_type === 'employee' ? assignment.profile_id : ''));
  const present = teams.map(team => ({ ...team,
    count: team.slot.members.filter(member => assigned.has(member.profile_id)).length,
  })).filter(team => team.count > 0);
  if (!present.length) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 flex h-[3px] overflow-hidden rounded-t-md"
      aria-label={present.map(({ slot, name, count }) => `${name}, bucket ${slot.slot_index}: ${count} of ${slot.members.length} members assigned`).join('; ')}
      data-testid={`schedule-visit-team-colours-${visitId}`}>
      {present.map(({ slot }) => <span key={slot.slot_index} className="flex-1"
        data-team-slot={slot.slot_index} style={{ backgroundColor: scheduleTeamColour(slot.slot_index).accent }} />)}
    </div>
  );
}
