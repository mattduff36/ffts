export interface OrganogramTeamDefinition {
  id: string;
  name: string;
  primaryLeaderName: string;
  secondaryLeaderName?: string;
  managerRoleName: string;
  managerRoleDisplayName: string;
}

export interface OrganogramPersonMapping {
  fullName: string;
  teamId: string;
  primaryManagerName?: string;
  secondaryManagerName?: string;
  roleType: 'leader' | 'member';
}

export const ORGANOGRAM_TEAMS: OrganogramTeamDefinition[] = [
  {
    id: 'executive',
    name: 'Executive',
    primaryLeaderName: 'Executive Lead',
    managerRoleName: 'managing-director',
    managerRoleDisplayName: 'Managing Director',
  },
  {
    id: 'sheq',
    name: 'SHEQ',
    primaryLeaderName: 'Example User Three',
    managerRoleName: 'sheq-manager',
    managerRoleDisplayName: 'SHEQ Manager',
  },
  {
    id: 'finance_payroll',
    name: 'Finance and Payroll',
    primaryLeaderName: 'Example User Four',
    managerRoleName: 'company-accountant-manager',
    managerRoleDisplayName: 'Company Accountant',
  },
  {
    id: 'heavy_plant_earthworks',
    name: 'Heavy Plant and Earthworks',
    primaryLeaderName: 'Example User Five',
    managerRoleName: 'heavy-plant-earthworks-contracts-manager',
    managerRoleDisplayName: 'Heavy Plant and Earthworks Contracts Manager',
  },
  {
    id: 'civils',
    name: 'Civils',
    primaryLeaderName: 'Example User One',
    secondaryLeaderName: 'Example User Two',
    managerRoleName: 'civils-manager',
    managerRoleDisplayName: 'Civils Manager',
  },
  {
    id: 'transport',
    name: 'Transport',
    primaryLeaderName: 'Example User Six',
    managerRoleName: 'transport-manager',
    managerRoleDisplayName: 'Transport Manager',
  },
  {
    id: 'workshop_yard',
    name: 'Workshop and Yard',
    primaryLeaderName: 'Example User Seven',
    managerRoleName: 'workshop-manager',
    managerRoleDisplayName: 'Workshop Manager',
  },
];

export const ORGANOGRAM_MANAGER_ROLES: Array<{
  name: string;
  display_name: string;
  description: string;
  role_class: 'manager';
  is_manager_admin: true;
  is_super_admin: false;
}> = [
  {
    name: 'managing-director',
    display_name: 'Managing Director',
    description: 'Executive manager role for the Managing Director.',
    role_class: 'manager',
    is_manager_admin: true,
    is_super_admin: false,
  },
  {
    name: 'sheq-manager',
    display_name: 'SHEQ Manager',
    description: 'Manager role for SHEQ oversight.',
    role_class: 'manager',
    is_manager_admin: true,
    is_super_admin: false,
  },
  {
    name: 'company-accountant-manager',
    display_name: 'Company Accountant',
    description: 'Manager role for finance and payroll oversight.',
    role_class: 'manager',
    is_manager_admin: true,
    is_super_admin: false,
  },
  {
    name: 'heavy-plant-earthworks-contracts-manager',
    display_name: 'Heavy Plant and Earthworks Contracts Manager',
    description: 'Manager role for heavy plant and earthworks operations.',
    role_class: 'manager',
    is_manager_admin: true,
    is_super_admin: false,
  },
  {
    name: 'civils-project-manager',
    display_name: 'Civils Project Manager',
    description: 'Manager role for civils project delivery.',
    role_class: 'manager',
    is_manager_admin: true,
    is_super_admin: false,
  },
  {
    name: 'civils-contracts-manager',
    display_name: 'Civils Contracts Manager',
    description: 'Manager role for civils contracts operations.',
    role_class: 'manager',
    is_manager_admin: true,
    is_super_admin: false,
  },
  {
    name: 'transport-manager',
    display_name: 'Transport Manager',
    description: 'Manager role for transport operations.',
    role_class: 'manager',
    is_manager_admin: true,
    is_super_admin: false,
  },
  {
    name: 'workshop-manager',
    display_name: 'Workshop Manager',
    description: 'Manager role for workshop and yard operations.',
    role_class: 'manager',
    is_manager_admin: true,
    is_super_admin: false,
  },
  {
    name: 'civils-manager',
    display_name: 'Civils Manager',
    description: 'Manager role for civils operations and projects.',
    role_class: 'manager',
    is_manager_admin: true,
    is_super_admin: false,
  },
  {
    name: 'civils-site-managers-supervisors-manager',
    display_name: 'Civils Site Managers and Supervisors Manager',
    description: 'Manager role for civils site managers and supervisors.',
    role_class: 'manager',
    is_manager_admin: true,
    is_super_admin: false,
  },
];

export const ORGANOGRAM_PEOPLE: OrganogramPersonMapping[] = [
  {
    fullName: 'Executive Lead',
    teamId: 'executive',
    roleType: 'leader',
  },
  {
    fullName: 'Example User Three',
    teamId: 'sheq',
    roleType: 'leader',
  },
  {
    fullName: 'Example User Four',
    teamId: 'finance_payroll',
    roleType: 'leader',
  },
  {
    fullName: 'Priority Manager',
    teamId: 'finance_payroll',
    primaryManagerName: 'Example User Four',
    roleType: 'member',
  },
  {
    fullName: 'Finance Lead',
    teamId: 'finance_payroll',
    primaryManagerName: 'Example User Four',
    roleType: 'member',
  },
  {
    fullName: 'Example User Five',
    teamId: 'heavy_plant_earthworks',
    roleType: 'leader',
  },
  {
    fullName: 'Example User One',
    teamId: 'civils',
    roleType: 'leader',
  },
  {
    fullName: 'Example User Two',
    teamId: 'civils',
    roleType: 'leader',
  },
  {
    fullName: 'Example User Six',
    teamId: 'transport',
    roleType: 'leader',
  },
  {
    fullName: 'Example User Seven',
    teamId: 'workshop_yard',
    roleType: 'leader',
  },
];
