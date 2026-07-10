'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { PanelLoader } from '@/components/ui/panel-loader';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TeamToggleMenu } from '@/components/ui/team-toggle-menu';
import { Loader2, Save, Users, X, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { createClient } from '@/lib/supabase/client';
import { fetchUserDirectory } from '@/lib/client/user-directory';
import { isAdminRole } from '@/lib/utils/role-access';
import { toast } from 'sonner';
import type { MaintenanceCategory } from '@/types/maintenance';

interface Profile {
  id: string;
  full_name: string | null;
  team: {
    id: string;
    name: string;
  } | null;
  role: {
    name: string;
    is_manager_admin: boolean;
  } | null;
  hasModuleAccess?: boolean;
}

interface CategoryRecipientsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: MaintenanceCategory;
}

export function CategoryRecipientsDialog({
  open,
  onOpenChange,
  category,
}: CategoryRecipientsDialogProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  
  // Fetch profiles and current recipients when dialog opens
  useEffect(() => {
    if (open) {
      const fetchData = async () => {
        setLoading(true);
        const supabase = createClient();
        
        try {
          // Fetch current recipients for this category
          const [profilesData, { data: recipientsData, error: recipientsError }] = await Promise.all([
            fetchUserDirectory({ includeRole: true, module: 'maintenance' }),
            supabase
              .from('maintenance_category_recipients')
              .select('user_id')
              .eq('category_id', category.id),
          ]);
          
          if (recipientsError) throw recipientsError;
          
          setProfiles(
            profilesData.map((profile) => ({
              id: profile.id,
              full_name: profile.full_name,
              team: profile.team?.id
                ? {
                    id: profile.team.id,
                    name: profile.team.name || profile.team.id,
                  }
                : null,
              role: profile.role?.name
                ? {
                    name: profile.role.name,
                    is_manager_admin: profile.role.is_manager_admin === true,
                  }
                : null,
              hasModuleAccess: profile.has_module_access !== false,
            }))
          );
          setSelectedUserIds(new Set(recipientsData?.map((r: { user_id: string }) => r.user_id) || []));
        } catch (error) {
          console.error('Error fetching data:', error);
          toast.error('Failed to load recipients');
        } finally {
          setLoading(false);
        }
      };
      fetchData();
    }
  }, [open, category.id]);

  const teamOptions = useMemo(() => {
    const teamMap = new Map<string, { id: string; name: string; hasAccess: boolean }>();

    profiles.forEach((profile) => {
      if (!profile.team?.id) return;

      const existing = teamMap.get(profile.team.id);
      if (existing) {
        existing.hasAccess = existing.hasAccess || profile.hasModuleAccess !== false;
        return;
      }

      teamMap.set(profile.team.id, {
        id: profile.team.id,
        name: profile.team.name,
        hasAccess: profile.hasModuleAccess !== false,
      });
    });

    return Array.from(teamMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [profiles]);

  const accessibleTeamOptions = useMemo(
    () => teamOptions.filter((team) => team.hasAccess),
    [teamOptions]
  );
  
  const handleToggleUser = (userId: string) => {
    const profile = profiles.find((candidate) => candidate.id === userId);
    if (!profile || profile.hasModuleAccess === false) return;

    const newSelected = new Set(selectedUserIds);
    if (newSelected.has(userId)) {
      newSelected.delete(userId);
    } else {
      newSelected.add(userId);
    }
    setSelectedUserIds(newSelected);
  };
  
  const handleSave = async () => {
    setSaving(true);
    
    try {
      const response = await fetch(`/api/maintenance/categories/${category.id}/recipients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_ids: Array.from(selectedUserIds),
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save recipients');
      }
      
      toast.success('Recipients updated', {
        description: `${data.count} user(s) will receive reminders for ${category.name}`,
      });
      
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving recipients:', error);
      toast.error('Failed to save recipients', {
        description: error instanceof Error ? error.message : 'Please try again',
      });
    } finally {
      setSaving(false);
    }
  };
  
  const handleSelectAllManagers = () => {
    const managerIds = profiles
      .filter(
        (p) =>
          p.hasModuleAccess !== false &&
          (p.role?.is_manager_admin || isAdminRole(p.role) || p.role?.name === 'manager')
      )
      .map(p => p.id);
    setSelectedUserIds(new Set([...selectedUserIds, ...managerIds]));
  };
  
  const handleClearAll = () => {
    setSelectedUserIds(new Set());
  };

  const handleToggleTeam = (teamId: string) => {
    const teamUserIds = profiles
      .filter((profile) => profile.team?.id === teamId && profile.hasModuleAccess !== false)
      .map((profile) => profile.id);

    if (teamUserIds.length === 0) {
      return;
    }

    const nextSelected = new Set(selectedUserIds);
    const allTeamUsersSelected = teamUserIds.every((userId) => nextSelected.has(userId));

    if (allTeamUsersSelected) {
      teamUserIds.forEach((userId) => nextSelected.delete(userId));
    } else {
      teamUserIds.forEach((userId) => nextSelected.add(userId));
    }

    setSelectedUserIds(nextSelected);
  };

  const handleToggleAllTeams = () => {
    if (accessibleTeamOptions.length === 0) {
      return;
    }

    const nextSelected = new Set(selectedUserIds);
    const allTeamsSelected = accessibleTeamOptions.every((team) =>
      profiles
        .filter((profile) => profile.team?.id === team.id && profile.hasModuleAccess !== false)
        .every((profile) => nextSelected.has(profile.id))
    );

    if (allTeamsSelected) {
      profiles
        .filter((profile) => profile.hasModuleAccess !== false)
        .forEach((profile) => nextSelected.delete(profile.id));
    } else {
      profiles
        .filter((profile) => profile.hasModuleAccess !== false)
        .forEach((profile) => nextSelected.add(profile.id));
    }

    setSelectedUserIds(nextSelected);
  };
  
  // Filter profiles by search query
  const filteredProfiles = profiles.filter(p => {
    const name = p.full_name?.toLowerCase() || '';
    const query = searchQuery.toLowerCase();
    return name.includes(query);
  });
  
  // Sort to show managers first, then by name
  const sortedProfiles = [...filteredProfiles].sort((a, b) => {
    const aIsManager = a.role?.is_manager_admin || isAdminRole(a.role) || a.role?.name === 'manager';
    const bIsManager = b.role?.is_manager_admin || isAdminRole(b.role) || b.role?.name === 'manager';
    
    if (aIsManager && !bIsManager) return -1;
    if (!aIsManager && bIsManager) return 1;
    
    return (a.full_name || '').localeCompare(b.full_name || '');
  });
  const selectedTeamCount = accessibleTeamOptions.filter((team) =>
    profiles
      .filter((profile) => profile.team?.id === team.id && profile.hasModuleAccess !== false)
      .every((profile) => selectedUserIds.has(profile.id))
  ).length;
  const allTeamsSelected = accessibleTeamOptions.length > 0 && selectedTeamCount === accessibleTeamOptions.length;
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-lg overflow-y-auto border-border text-white">
        <DialogHeader>
          <DialogTitle className="text-xl flex items-center gap-2">
            <Users className="h-5 w-5" />
            Reminder Recipients
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Select users who should receive reminders for <strong>{category.name}</strong>
          </DialogDescription>
        </DialogHeader>
        
        {loading ? (
          <PanelLoader message="Loading reminder recipients..." accent="maintenance" className="py-12" />
        ) : (
          <div className="space-y-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search users..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-input border-border text-white"
              />
            </div>
            
            {/* Quick actions */}
            <div className="flex gap-2">
              <TeamToggleMenu
                teams={teamOptions.map((team) => ({
                  ...team,
                  selected: (() => {
                    const teamProfiles = profiles.filter(
                      (profile) => profile.team?.id === team.id && profile.hasModuleAccess !== false
                    );
                    return teamProfiles.length > 0 && teamProfiles.every((profile) => selectedUserIds.has(profile.id));
                  })(),
                }))}
                selectedTeamCount={selectedTeamCount}
                allTeamsSelected={allTeamsSelected}
                onToggleTeam={handleToggleTeam}
                onToggleAllTeams={handleToggleAllTeams}
                disabled={loading || teamOptions.length === 0}
                triggerLabel="Select Teams"
                triggerClassName="text-xs border-maintenance text-maintenance hover:bg-maintenance hover:text-white"
                activeItemClassName="bg-maintenance text-white"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSelectAllManagers}
                className="text-xs border-slate-600 hover:bg-slate-800"
              >
                Select All Managers
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleClearAll}
                className="text-xs border-slate-600 hover:bg-slate-800"
              >
                <X className="h-3 w-3 mr-1" />
                Clear All
              </Button>
            </div>
            
            {/* User list */}
            <ScrollArea className="h-[300px] border border-slate-700 rounded-lg">
              <div className="p-2 space-y-1">
                {sortedProfiles.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-8">
                    No users found
                  </p>
                ) : (
                  sortedProfiles.map((profile) => {
                    const isManager =
                      profile.role?.is_manager_admin ||
                      isAdminRole(profile.role) ||
                      profile.role?.name === 'manager';
                    const isSelected = selectedUserIds.has(profile.id);
                    
                    return (
                      <div
                        key={profile.id}
                        className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${
                          profile.hasModuleAccess === false
                            ? 'opacity-60 border border-transparent'
                            : isSelected 
                              ? 'bg-blue-600/20 border border-blue-500/30' 
                              : 'hover:bg-slate-800 border border-transparent'
                        }`}
                        onClick={() => profile.hasModuleAccess !== false && handleToggleUser(profile.id)}
                      >
                        <div className="flex items-center gap-3">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => handleToggleUser(profile.id)}
                            disabled={profile.hasModuleAccess === false}
                            className="data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                          />
                          <div>
                            <p className="text-sm font-medium text-white">
                              {profile.full_name || 'Unknown User'}
                            </p>
                            {profile.role && (
                              <p className="text-xs text-slate-400 capitalize">
                                {profile.hasModuleAccess === false
                                  ? `${profile.role.name} • No Maintenance access`
                                  : profile.role.name}
                              </p>
                            )}
                          </div>
                        </div>
                        {isManager && (
                          <Badge variant="outline" className="text-xs text-amber-400 border-amber-400/50">
                            Manager
                          </Badge>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>
            
            {/* Selected count */}
            <p className="text-sm text-muted-foreground">
              {selectedUserIds.size} user{selectedUserIds.size !== 1 ? 's' : ''} selected
            </p>
          </div>
        )}
        
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="border-slate-600 text-white hover:bg-slate-800"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={loading || saving}
            className="bg-maintenance hover:bg-maintenance-dark"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save Recipients
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
