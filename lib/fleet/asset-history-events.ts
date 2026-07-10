export type AssetHistoryAssetType = 'van' | 'hgv' | 'plant';
export type AssetHistoryRowType = 'record' | 'workshop' | 'dailyTask';

export interface AssetHistoryRecordSource {
  id: string;
  created_at: string | null;
  updated_by_name: string | null;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  comment: string | null;
}

export interface AssetHistoryWorkshopTaskSource {
  id: string;
  action_type: string;
  title: string;
  description?: string | null;
  status: string;
  priority?: string | null;
  workshop_comments?: string | null;
  logged_at?: string | null;
  logged_by?: string | null;
  logged_comment?: string | null;
  actioned_at?: string | null;
  actioned_by?: string | null;
  actioned_comment?: string | null;
  status_history?: unknown[] | null;
  created_at: string;
  created_by?: string | null;
  workshop_task_categories?: {
    id?: string;
    name: string;
    slug?: string | null;
    ui_color?: string | null;
  } | null;
  workshop_task_subcategories?: {
    id?: string;
    name: string;
    slug?: string | null;
    ui_color?: string | null;
    workshop_task_categories?: {
      id?: string;
      name: string;
      slug?: string | null;
      ui_color?: string | null;
    };
  } | null;
  profiles_created?: {
    full_name: string | null;
  } | null;
  profiles?: {
    full_name: string | null;
  } | null;
}

export interface AssetHistoryDailyTaskSource {
  id: string;
  inspection_date: string;
  inspection_end_date: string | null;
  submitted_at: string | null;
  status: 'draft' | 'submitted' | string;
  current_mileage: number | null;
  defect_count?: number;
  profile: { full_name: string | null } | null;
}

interface AssetHistoryRowBase {
  id: string;
  type: AssetHistoryRowType;
  timestamp: string;
  sortTime: number;
  typeLabel: string;
  summary: string;
  statusLabel: string | null;
  person: string;
  meter: string | null;
}

export interface AssetHistoryRecordRow extends AssetHistoryRowBase {
  type: 'record';
  fieldLabel: string;
  oldValue: string | null;
  newValue: string | null;
  comment: string | null;
  source: AssetHistoryRecordSource;
}

export interface AssetHistoryWorkshopRow extends AssetHistoryRowBase {
  type: 'workshop';
  source: AssetHistoryWorkshopTaskSource;
}

export interface AssetHistoryDailyTaskRow extends AssetHistoryRowBase {
  type: 'dailyTask';
  href: string;
  inspectionRange: string;
  source: AssetHistoryDailyTaskSource;
}

export type AssetHistoryRow =
  | AssetHistoryRecordRow
  | AssetHistoryWorkshopRow
  | AssetHistoryDailyTaskRow;

export interface AssetHistoryFilters {
  record: boolean;
  workshop: boolean;
  dailyTask: boolean;
}

export interface BuildAssetHistoryRowsInput {
  assetType: AssetHistoryAssetType;
  records: AssetHistoryRecordSource[];
  workshopTasks: AssetHistoryWorkshopTaskSource[];
  dailyTasks: AssetHistoryDailyTaskSource[];
  getFieldLabel: (fieldName: string) => string;
}

const DAILY_TASK_ROUTE_PREFIX: Record<AssetHistoryAssetType, string> = {
  van: '/van-inspections',
  hgv: '/hgv-inspections',
  plant: '/plant-inspections',
};

function getSortTime(timestamp: string | null | undefined) {
  if (!timestamp) return 0;
  const parsed = new Date(timestamp).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function getMeterLabel(value: number | null, assetType: AssetHistoryAssetType) {
  if (value == null) return null;

  const formattedValue = value.toLocaleString();
  if (assetType === 'plant') return `${formattedValue}h`;
  if (assetType === 'hgv') return `${formattedValue} km`;

  return `${formattedValue} miles`;
}

function formatNamePart(part: string) {
  if (!part) return part;
  if (part !== part.toLowerCase() && part !== part.toUpperCase()) return part;

  return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
}

export function formatHistoryPersonName(name: string | null | undefined) {
  const trimmedName = name?.trim();
  if (!trimmedName) return 'Unknown';
  if (trimmedName === 'System' || trimmedName === 'Unknown') return trimmedName;

  return trimmedName
    .split(' ')
    .filter(Boolean)
    .map((word) => word
      .split(/([-'’])/)
      .map((part) => (part === '-' || part === '\'' || part === '’' ? part : formatNamePart(part)))
      .join(''))
    .join(' ');
}

function getWorkshopTypeLabel(task: AssetHistoryWorkshopTaskSource) {
  return task.action_type === 'inspection_defect' ? 'Inspection Defect' : 'Workshop';
}

function getWorkshopPerson(task: AssetHistoryWorkshopTaskSource) {
  return formatHistoryPersonName(task.profiles_created?.full_name || task.profiles?.full_name);
}

function buildRecordRows(
  records: AssetHistoryRecordSource[],
  getFieldLabel: (fieldName: string) => string
): AssetHistoryRecordRow[] {
  return records
    .filter((record) => Boolean(record.created_at))
    .map((record) => {
      const fieldLabel = getFieldLabel(record.field_name);
      return {
        id: `record-${record.id}`,
        type: 'record',
        timestamp: record.created_at || '',
        sortTime: getSortTime(record.created_at),
        typeLabel: 'Record',
        summary: fieldLabel,
        statusLabel: null,
        person: record.updated_by_name ? formatHistoryPersonName(record.updated_by_name) : 'System',
        meter: null,
        fieldLabel,
        oldValue: record.old_value,
        newValue: record.new_value,
        comment: record.comment,
        source: record,
      };
    });
}

function buildWorkshopRows(workshopTasks: AssetHistoryWorkshopTaskSource[]): AssetHistoryWorkshopRow[] {
  return workshopTasks.map((task) => ({
    id: `workshop-${task.id}`,
    type: 'workshop',
    timestamp: task.created_at,
    sortTime: getSortTime(task.created_at),
    typeLabel: getWorkshopTypeLabel(task),
    summary: task.title || task.workshop_task_categories?.name || 'Workshop task',
    statusLabel: task.status,
    person: getWorkshopPerson(task),
    meter: null,
    source: task,
  }));
}

function buildDailyTaskRows(
  dailyTasks: AssetHistoryDailyTaskSource[],
  assetType: AssetHistoryAssetType
): AssetHistoryDailyTaskRow[] {
  return dailyTasks.map((dailyTask) => {
    const timestamp = dailyTask.submitted_at || dailyTask.inspection_date;
    const defectCount = dailyTask.defect_count || 0;
    const inspectionRange = dailyTask.inspection_date;

    return {
      id: `daily-task-${dailyTask.id}`,
      type: 'dailyTask',
      timestamp,
      sortTime: getSortTime(timestamp),
      typeLabel: 'Daily Task',
      summary: `Daily check submitted`,
      statusLabel: defectCount > 0
        ? `${defectCount} ${defectCount === 1 ? 'Defect' : 'Defects'}`
        : 'All Passed',
      person: formatHistoryPersonName(dailyTask.profile?.full_name),
      meter: getMeterLabel(dailyTask.current_mileage, assetType),
      href: `${DAILY_TASK_ROUTE_PREFIX[assetType]}/${dailyTask.id}`,
      inspectionRange,
      source: dailyTask,
    };
  });
}

export function buildAssetHistoryRows({
  assetType,
  records,
  workshopTasks,
  dailyTasks,
  getFieldLabel,
}: BuildAssetHistoryRowsInput): AssetHistoryRow[] {
  return [
    ...buildRecordRows(records, getFieldLabel),
    ...buildWorkshopRows(workshopTasks),
    ...buildDailyTaskRows(dailyTasks, assetType),
  ].sort((a, b) => b.sortTime - a.sortTime);
}

export function filterAssetHistoryRows(
  rows: AssetHistoryRow[],
  filters: AssetHistoryFilters
): AssetHistoryRow[] {
  return rows.filter((row) => filters[row.type]);
}
