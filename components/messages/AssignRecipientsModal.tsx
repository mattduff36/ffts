'use client';

import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TeamToggleMenu } from '@/components/ui/team-toggle-menu';
import { Loader2, Send, Search } from 'lucide-react';
import { toast } from 'sonner';
import { fetchUserDirectory } from '@/lib/client/user-directory';

interface Employee {
  id: string;
  full_name: string;
  team: {
    id: string;
    name: string;
  } | null;
  role: {
    name: string;
    display_name: string;
  } | null;
}

interface Role {
  name: string;
  display_name: string;
}

interface AssignRecipientsModalProps {
  open: boolean;
  onClose: () => void;
  onSend: (employeeIds: string[]) => Promise<void>;
  messageSubject: string;
  messageType: 'TOOLBOX_TALK' | 'REMINDER';
}

export function AssignRecipientsModal({
  open,
  onClose,
  onSend,
  messageSubject,
  messageType,
}: AssignRecipientsModalProps) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [filteredEmployees, setFilteredEmployees] = useState<Employee[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  useEffect(() => {
    if (open) {
      async function fetchEmployees() {
        setFetching(true);
        try {
          const allEmployees = await fetchUserDirectory({ includeRole: true });
          const typedEmployees = allEmployees.map((employee) => ({
            id: employee.id,
            full_name: employee.full_name || 'Unknown User',
            team: employee.team?.id
              ? {
                  id: employee.team.id,
                  name: employee.team.name || employee.team.id,
                }
              : null,
            role: employee.role?.name
              ? {
                  name: employee.role.name,
                  display_name: employee.role.display_name || employee.role.name,
                }
              : null,
          }));
          const roleMap = new Map<string, Role>();

          typedEmployees.forEach((employee) => {
            if (!employee.role?.name) return;
            if (!roleMap.has(employee.role.name)) {
              roleMap.set(employee.role.name, {
                name: employee.role.name,
                display_name: employee.role.display_name,
              });
            }
          });

          const roleOptions = Array.from(roleMap.values()).sort((a, b) =>
            a.display_name.localeCompare(b.display_name)
          );

          setRoles(roleOptions);
          setEmployees(typedEmployees);
          setFilteredEmployees(typedEmployees);
        } catch (error) {
          console.error('Error fetching employees:', error);
          toast.error('Failed to load employees');
        } finally {
          setFetching(false);
        }
      }
      fetchEmployees();
    }
  }, [open]);

  useEffect(() => {
    if (searchQuery) {
      setFilteredEmployees(
        employees.filter(emp =>
          emp.full_name.toLowerCase().includes(searchQuery.toLowerCase())
        )
      );
    } else {
      setFilteredEmployees(employees);
    }
  }, [searchQuery, employees]);

  const teamOptions = useMemo(() => {
    const teamMap = new Map<string, { id: string; name: string; hasAccess: boolean }>();

    employees.forEach((employee) => {
      if (!employee.team?.id) return;

      if (teamMap.has(employee.team.id)) {
        return;
      }

      teamMap.set(employee.team.id, {
        id: employee.team.id,
        name: employee.team.name,
        hasAccess: true,
      });
    });

    return Array.from(teamMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [employees]);

  const handleToggleEmployee = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleToggleTeam = (teamId: string) => {
    const teamEmployeeIds = employees
      .filter((employee) => employee.team?.id === teamId)
      .map((employee) => employee.id);

    if (teamEmployeeIds.length === 0) {
      return;
    }

    const nextSelected = new Set(selectedIds);
    const allTeamEmployeesSelected = teamEmployeeIds.every((employeeId) => nextSelected.has(employeeId));

    if (allTeamEmployeesSelected) {
      teamEmployeeIds.forEach((employeeId) => nextSelected.delete(employeeId));
    } else {
      teamEmployeeIds.forEach((employeeId) => nextSelected.add(employeeId));
    }

    setSelectedIds(nextSelected);
  };

  const handleToggleAllTeams = () => {
    if (teamOptions.length === 0) {
      return;
    }

    const nextSelected = new Set(selectedIds);
    const allTeamsSelected = teamOptions.every((team) =>
      employees
        .filter((employee) => employee.team?.id === team.id)
        .every((employee) => nextSelected.has(employee.id))
    );

    if (allTeamsSelected) {
      employees.forEach((employee) => nextSelected.delete(employee.id));
    } else {
      employees.forEach((employee) => nextSelected.add(employee.id));
    }

    setSelectedIds(nextSelected);
  };

  const handleSelectRole = (role: string) => {
    const employeesWithRole = employees.filter((emp) => emp.role?.name === role);
    // Check if all employees in this role are already selected
    const allRoleSelected = employeesWithRole.every(emp => selectedIds.has(emp.id));
    
    const newSelected = new Set(selectedIds);
    
    if (allRoleSelected) {
      // Unselect all employees in this role
      employeesWithRole.forEach(emp => {
        newSelected.delete(emp.id);
      });
    } else {
      // Select all employees in this role
      employeesWithRole.forEach(emp => {
        newSelected.add(emp.id);
      });
    }
    
    setSelectedIds(newSelected);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (selectedIds.size === 0) {
      toast.error('Please select at least one recipient');
      return;
    }

    setLoading(true);

    try {
      await onSend(Array.from(selectedIds));
      
      // Reset and close
      setSelectedIds(new Set());
      setSearchQuery('');
      onClose();
    } catch (error) {
      console.error('Send error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to send message');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (loading) return;
    setSelectedIds(new Set());
    setSearchQuery('');
    onClose();
  };

  const selectedTeamCount = teamOptions.filter((team) =>
    employees
      .filter((employee) => employee.team?.id === team.id)
      .every((employee) => selectedIds.has(employee.id))
  ).length;
  const allTeamsSelected = teamOptions.length > 0 && selectedTeamCount === teamOptions.length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[700px] max-h-[85vh] bg-white dark:bg-slate-900 border-border z-[100]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {messageType === 'TOOLBOX_TALK' ? 'Choose Recipients for Toolbox Talk' : 'Choose Recipients for Reminder'}
            </DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">{messageSubject}</span>
              <br />
              Select employees to receive this message
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Role Filter Section */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Quick Select by Role:
              </label>
              <div className="grid grid-cols-2 gap-2">
                {roles.map((role) => {
                  const roleEmployees = employees.filter((emp) => emp.role?.name === role.name);
                  const roleCount = roleEmployees.length;
                  const allRoleSelected = roleEmployees.length > 0 && roleEmployees.every(emp => selectedIds.has(emp.id));
                  
                  return (
                    <Button
                      key={role.name}
                      type="button"
                      variant={allRoleSelected ? "default" : "outline"}
                      size="sm"
                      onClick={() => handleSelectRole(role.name)}
                      disabled={loading || fetching || roleCount === 0}
                      className={`justify-start text-sm transition-all ${
                        allRoleSelected 
                          ? 'bg-brand-yellow text-slate-900 font-semibold border-2 border-brand-yellow shadow-lg' 
                          : 'hover:bg-slate-800'
                      }`}
                    >
                      {allRoleSelected && '✓ '}{role.display_name} ({roleCount})
                    </Button>
                  );
                })}
              </div>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search employees..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                disabled={loading || fetching}
                className="pl-10"
              />
            </div>

            <div className="flex items-center justify-between border-b pb-2">
              <TeamToggleMenu
                teams={teamOptions.map((team) => ({
                  ...team,
                  selected: (() => {
                    const teamEmployees = employees.filter((employee) => employee.team?.id === team.id);
                    return teamEmployees.length > 0 && teamEmployees.every((employee) => selectedIds.has(employee.id));
                  })(),
                }))}
                selectedTeamCount={selectedTeamCount}
                allTeamsSelected={allTeamsSelected}
                onToggleTeam={handleToggleTeam}
                onToggleAllTeams={handleToggleAllTeams}
                disabled={loading || fetching || teamOptions.length === 0}
                triggerLabel="Select Teams"
                triggerClassName={
                  messageType === 'TOOLBOX_TALK'
                    ? 'border-red-600 text-red-500 hover:bg-red-600 hover:text-white text-xs'
                    : 'border-blue-600 text-blue-500 hover:bg-blue-600 hover:text-white text-xs'
                }
                activeItemClassName={messageType === 'TOOLBOX_TALK' ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'}
              />
              <span className="text-sm text-muted-foreground">
                {selectedIds.size} selected
              </span>
            </div>

            {/* Employees List */}
            {fetching ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : (
              <ScrollArea className="h-[300px] pr-4">
                <div className="space-y-2">
                  {filteredEmployees.length === 0 ? (
                    <p className="text-center text-muted-foreground py-4">
                      No employees found
                    </p>
                  ) : (
                    filteredEmployees.map((employee) => (
                      <div
                        key={employee.id}
                        className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-accent/50"
                      >
                        <Checkbox
                          id={employee.id}
                          checked={selectedIds.has(employee.id)}
                          onCheckedChange={() => handleToggleEmployee(employee.id)}
                          disabled={loading}
                        />
                        <label
                          htmlFor={employee.id}
                          className="flex-1 text-sm font-medium cursor-pointer peer-disabled:cursor-not-allowed"
                        >
                          {employee.full_name}
                        </label>
                        <span className="text-xs text-muted-foreground">
                          {employee.role?.display_name || 'No Role'}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            )}

          </div>

          <DialogFooter className="gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={loading || selectedIds.size === 0}
              className={messageType === 'TOOLBOX_TALK' 
                ? 'bg-red-600 hover:bg-red-700 text-white' 
                : 'bg-blue-600 hover:bg-blue-700 text-white'
              }
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  {messageType === 'TOOLBOX_TALK' ? 'Send Toolbox Talk' : 'Send Reminder'} ({selectedIds.size})
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

