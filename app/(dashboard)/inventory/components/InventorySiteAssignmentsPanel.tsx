'use client';

import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MapPin, Trash2, UserPlus } from 'lucide-react';
import type { InventoryLocation } from '../types';

export interface InventorySiteAssignmentUser {
  id: string;
  full_name: string | null;
  employee_id: string | null;
}

export interface InventorySiteAssignment {
  user_id: string;
  location_id: string;
  assigned_by: string | null;
  assigned_at: string;
  note: string | null;
  user?: InventorySiteAssignmentUser | null;
  location?: InventoryLocation | null;
}

interface InventorySiteAssignmentsPanelProps {
  users: InventorySiteAssignmentUser[];
  activeSites: InventoryLocation[];
  assignments: InventorySiteAssignment[];
  onAssign: (payload: { userId: string; locationId: string }) => Promise<void>;
  onRemove: (payload: { userId: string; locationId: string }) => Promise<void>;
}

function getUserLabel(user: InventorySiteAssignmentUser | null | undefined): string {
  if (!user) return 'Unknown user';
  return [user.full_name || 'Unnamed user', user.employee_id ? `#${user.employee_id}` : null]
    .filter(Boolean)
    .join(' ');
}

function getSiteLabel(site: InventoryLocation | null | undefined): string {
  if (!site) return 'Unknown Site';
  return site.external_reference ? `${site.external_reference} - ${site.name}` : site.name;
}

export function InventorySiteAssignmentsPanel({
  users,
  activeSites,
  assignments,
  onAssign,
  onRemove,
}: InventorySiteAssignmentsPanelProps) {
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [saving, setSaving] = useState(false);
  const [removingKey, setRemovingKey] = useState<string | null>(null);

  const assignedSiteIdsForSelectedUser = useMemo(() => new Set(
    assignments
      .filter((assignment) => assignment.user_id === selectedUserId)
      .map((assignment) => assignment.location_id)
  ), [assignments, selectedUserId]);

  const availableSites = useMemo(
    () => activeSites.filter((site) => !assignedSiteIdsForSelectedUser.has(site.id)),
    [activeSites, assignedSiteIdsForSelectedUser]
  );

  async function handleAssign() {
    if (!selectedUserId || !selectedLocationId) return;
    setSaving(true);
    try {
      await onAssign({ userId: selectedUserId, locationId: selectedLocationId });
      setSelectedLocationId('');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(assignment: InventorySiteAssignment) {
    const key = `${assignment.user_id}:${assignment.location_id}`;
    setRemovingKey(key);
    try {
      await onRemove({ userId: assignment.user_id, locationId: assignment.location_id });
    } finally {
      setRemovingKey(null);
    }
  }

  return (
    <Card className="border-slate-700 bg-slate-900/70">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-white">
          <MapPin className="h-5 w-5 text-inventory" />
          Site Location Assignments
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <div className="space-y-2">
            <Label>Employee</Label>
            <Select value={selectedUserId} onValueChange={(value) => {
              setSelectedUserId(value);
              setSelectedLocationId('');
            }}>
              <SelectTrigger className="border-slate-600 bg-slate-800">
                <SelectValue placeholder="Select employee" />
              </SelectTrigger>
              <SelectContent>
                {users.map((user) => (
                  <SelectItem key={user.id} value={user.id}>{getUserLabel(user)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Active Site Location</Label>
            <Select value={selectedLocationId} onValueChange={setSelectedLocationId} disabled={!selectedUserId}>
              <SelectTrigger className="border-slate-600 bg-slate-800">
                <SelectValue placeholder="Select Site" />
              </SelectTrigger>
              <SelectContent>
                {availableSites.map((site) => (
                  <SelectItem key={site.id} value={site.id}>{getSiteLabel(site)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            type="button"
            onClick={handleAssign}
            disabled={saving || !selectedUserId || !selectedLocationId}
            className="bg-inventory text-white hover:bg-inventory-dark"
          >
            <UserPlus className="mr-2 h-4 w-4" />
            Assign Site
          </Button>
        </div>

        <div className="space-y-3">
          {assignments.length > 0 ? assignments.map((assignment) => {
            const key = `${assignment.user_id}:${assignment.location_id}`;
            const site = assignment.location || activeSites.find((candidate) => candidate.id === assignment.location_id);

            return (
              <div key={key} className="flex flex-col gap-3 rounded-lg border border-slate-700 bg-slate-800/50 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-medium text-white">{getUserLabel(assignment.user)}</div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-300">
                      {getSiteLabel(site)}
                    </Badge>
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => { void handleRemove(assignment); }}
                  disabled={removingKey === key}
                  className="border-red-500/30 text-red-300 hover:bg-red-500/10"
                >
                  <Trash2 className="mr-2 h-3 w-3" />
                  Remove
                </Button>
              </div>
            );
          }) : (
            <p className="rounded-lg border border-slate-700 bg-slate-800/40 p-4 text-sm text-muted-foreground">
              No Site locations are assigned yet.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
