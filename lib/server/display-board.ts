import crypto from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/utils/logger';
import {
  calculateAlertCounts,
  getDateBasedStatus,
  getHoursBasedStatus,
  getMileageBasedStatus,
} from '@/lib/utils/maintenanceCalculations';
import {
  MAINTENANCE_CATEGORY_NAMES,
  categoryAppliesToAsset,
  createMaintenanceCategoryMap,
  getDistanceUnitLabel,
  getMaintenanceCategory,
  isMaintenanceCategoryVisibleOnOverview,
} from '@/lib/utils/maintenanceCategoryRules';
import {
  MOBILE_TEXT_SIZE_STEPS,
  type MobileTextSizeStep,
} from '@/lib/config/mobile-text-size-preference';
import { WORKSHOP_DISPLAY_BOARD_TEXT_SIZE_DEFAULT_STEP } from '@/lib/display-board/workshop-board-config';
import type {
  MaintenanceCategory,
  MaintenanceItem,
  MaintenanceItemStatus,
  MaintenanceListResponse,
  VehicleMaintenanceWithStatus,
} from '@/types/maintenance';
import { notifyDisplayBoardDevice } from '@/lib/server/display-board-notify';

export const WORKSHOP_DISPLAY_BOARD_KEY = 'workshop';
export const DISPLAY_BOARD_PAIRING_WINDOW_MS = 5 * 60 * 1000;
export const DISPLAY_BOARD_TOKEN_HEADER = 'x-display-board-token';
export const DISPLAY_BOARD_TEXT_SIZE_DEFAULT_STEP: MobileTextSizeStep = WORKSHOP_DISPLAY_BOARD_TEXT_SIZE_DEFAULT_STEP;

export interface DisplayBoardConfig {
  board_key: string;
  name: string;
  fallback_poll_interval_seconds: number;
  realtime_debounce_ms: number;
  is_enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface DisplayBoardPairingSession {
  id: string;
  board_key: string;
  confirmation_code: string | null;
  pairing_token_hash?: string | null;
  status: 'active' | 'confirmed' | 'cancelled' | 'expired';
  started_by: string | null;
  confirmed_by: string | null;
  candidate_seen_at: string | null;
  confirmed_at: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface DisplayBoardDevice {
  id: string;
  board_key: string;
  label: string | null;
  display_text_size_step: MobileTextSizeStep;
  paired_by: string | null;
  pairing_session_id: string | null;
  last_seen_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DisplayBoardAdminState {
  config: DisplayBoardConfig;
  active_pairing: DisplayBoardPairingSession | null;
  devices: DisplayBoardDevice[];
}

export interface DisplayBoardPairingResponse {
  status: 'pairing' | 'paired' | 'expired' | 'unavailable';
  confirmation_code?: string;
  pairing_token?: string;
  device_token?: string;
  expires_at?: string;
  message?: string;
}

export interface DisplayBoardMaintenanceItem {
  id: string;
  asset: string;
  asset_type: 'van' | 'hgv' | 'plant' | 'vehicle' | 'tool';
  category: string;
  status: 'overdue' | 'due_soon';
  detail: string;
}

export interface DisplayBoardWorkshopTask {
  id: string;
  asset: string;
  status: 'pending' | 'logged' | 'on_hold';
  source: string;
  category: string | null;
  summary: string;
  created_at: string | null;
  is_high_priority: boolean;
}

export interface DisplayBoardPayload {
  config: DisplayBoardConfig;
  device: {
    id: string;
  };
  display: {
    text_size_step: MobileTextSizeStep;
  };
  maintenance: {
    summary: MaintenanceListResponse['summary'];
    overdue_items: DisplayBoardMaintenanceItem[];
    due_soon_items: DisplayBoardMaintenanceItem[];
  };
  workshop: {
    counts: {
      pending: number;
      in_progress: number;
      on_hold: number;
      high_priority: number;
    };
    pending: DisplayBoardWorkshopTask[];
    in_progress: DisplayBoardWorkshopTask[];
    on_hold: DisplayBoardWorkshopTask[];
  };
  generated_at: string;
}

interface MaintenanceRow {
  id: string;
  van_id: string | null;
  hgv_id: string | null;
  plant_id: string | null;
  current_mileage: number | null;
  tax_due_date: string | null;
  mot_due_date: string | null;
  next_service_mileage: number | null;
  last_service_mileage: number | null;
  cambelt_due_mileage: number | null;
  tracker_id: string | null;
  first_aid_kit_expiry: string | null;
  six_weekly_inspection_due_date: string | null;
  fire_extinguisher_due_date: string | null;
  taco_calibration_due_date: string | null;
  current_hours: number | null;
  next_service_hours: number | null;
  last_service_hours: number | null;
  created_at: string;
  updated_at: string;
  last_updated_by: string | null;
  last_updated_at: string;
  last_mileage_update: string | null;
  notes: string | null;
}

interface CustomMaintenanceValueRow {
  id: string;
  maintenance_category_id: string;
  van_id: string | null;
  hgv_id: string | null;
  plant_id: string | null;
  due_date: string | null;
  due_mileage: number | null;
  last_mileage: number | null;
  due_hours: number | null;
  last_hours: number | null;
}

interface TaggedAsset {
  _assetType: 'van' | 'hgv' | 'plant';
  id: string;
  reg_number: string | null;
  category_id: string | null;
  status: string;
  nickname: string | null;
  plant_id?: string | null;
  serial_number?: string | null;
  year?: number | null;
  weight_class?: string | null;
  loler_due_date?: string | null;
  maintenance?: Record<string, unknown>[] | Record<string, unknown> | null;
}

interface WorkshopTaskRow {
  id: string;
  status: string | null;
  action_type: string | null;
  inspection_id: string | null;
  van_id: string | null;
  title: string | null;
  description: string | null;
  workshop_comments: string | null;
  created_at: string | null;
  hgv_id: string | null;
  plant_id: string | null;
  vans?: { reg_number: string | null; nickname: string | null } | Array<{ reg_number: string | null; nickname: string | null }> | null;
  hgvs?: { reg_number: string | null; nickname: string | null } | Array<{ reg_number: string | null; nickname: string | null }> | null;
  plant?: { plant_id: string | null; nickname: string | null } | Array<{ plant_id: string | null; nickname: string | null }> | null;
  workshop_task_categories?: { name: string | null } | Array<{ name: string | null }> | null;
  workshop_task_subcategories?: {
    name: string | null;
    workshop_task_categories?: { name: string | null } | Array<{ name: string | null }> | null;
  } | Array<{
    name: string | null;
    workshop_task_categories?: { name: string | null } | Array<{ name: string | null }> | null;
  }> | null;
}

type AnySupabaseClient = ReturnType<typeof createAdminClient>;

function getAdmin(): AnySupabaseClient {
  return createAdminClient() as AnySupabaseClient;
}

function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

function randomConfirmationCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function normalizeDisplayBoardTextSizeStep(value: unknown): MobileTextSizeStep {
  const numericValue = typeof value === 'number' ? value : Number(value);
  if (MOBILE_TEXT_SIZE_STEPS.includes(numericValue as MobileTextSizeStep)) {
    return numericValue as MobileTextSizeStep;
  }
  return DISPLAY_BOARD_TEXT_SIZE_DEFAULT_STEP;
}

function getAssetLabel(asset?: { reg_number?: string | null; plant_id?: string | null; nickname?: string | null } | null) {
  if (!asset) return 'Unknown';
  const identifier = asset.plant_id || asset.reg_number || 'Unknown';
  return asset.nickname ? `${identifier} (${asset.nickname})` : identifier;
}

function singleRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

function getAssetValueKey(assetType: 'van' | 'hgv' | 'plant', assetId: string): string {
  return `${assetType}:${assetId}`;
}

function getCustomValueAssetKey(value: CustomMaintenanceValueRow): string | null {
  if (value.van_id) return getAssetValueKey('van', value.van_id);
  if (value.hgv_id) return getAssetValueKey('hgv', value.hgv_id);
  if (value.plant_id) return getAssetValueKey('plant', value.plant_id);
  return null;
}

function getCategoryThreshold(category: MaintenanceCategory): number {
  if (category.type === 'date') return category.alert_threshold_days || 30;
  if (category.type === 'hours') return category.alert_threshold_hours || 50;
  return category.alert_threshold_miles || 1000;
}

function getStatusForCategory(params: {
  category: MaintenanceCategory;
  maintenance: MaintenanceRow | null;
  lolerDueDate: string | null;
  customValue?: CustomMaintenanceValueRow;
}): MaintenanceItemStatus {
  const { category, maintenance, customValue } = params;
  const threshold = getCategoryThreshold(category);

  if (category.field_key) {
    if (category.field_key === 'tax_due_date') return getDateBasedStatus(maintenance?.tax_due_date || null, threshold);
    if (category.field_key === 'mot_due_date') return getDateBasedStatus(maintenance?.mot_due_date || null, threshold);
    if (category.field_key === 'first_aid_kit_expiry') return getDateBasedStatus(maintenance?.first_aid_kit_expiry || null, threshold);
    if (category.field_key === 'six_weekly_inspection_due_date') return getDateBasedStatus(maintenance?.six_weekly_inspection_due_date || null, threshold);
    if (category.field_key === 'fire_extinguisher_due_date') return getDateBasedStatus(maintenance?.fire_extinguisher_due_date || null, threshold);
    if (category.field_key === 'taco_calibration_due_date') return getDateBasedStatus(maintenance?.taco_calibration_due_date || null, threshold);
    if (category.field_key === 'loler_due_date') return getDateBasedStatus(params.lolerDueDate, threshold);
    if (category.field_key === 'next_service_mileage') {
      return getMileageBasedStatus(maintenance?.current_mileage ?? null, maintenance?.next_service_mileage ?? null, threshold);
    }
    if (category.field_key === 'cambelt_due_mileage') {
      return getMileageBasedStatus(maintenance?.current_mileage ?? null, maintenance?.cambelt_due_mileage ?? null, threshold);
    }
    if (category.field_key === 'next_service_hours') {
      return getHoursBasedStatus(maintenance?.current_hours ?? null, maintenance?.next_service_hours ?? null, threshold);
    }
  }

  if (category.type === 'date') return getDateBasedStatus(customValue?.due_date || null, threshold);
  if (category.type === 'hours') {
    return getHoursBasedStatus(maintenance?.current_hours ?? null, customValue?.due_hours ?? null, threshold);
  }
  return getMileageBasedStatus(maintenance?.current_mileage ?? null, customValue?.due_mileage ?? null, threshold);
}

function getDueValuesForCategory(params: {
  category: MaintenanceCategory;
  maintenance: MaintenanceRow | null;
  lolerDueDate: string | null;
  customValue?: CustomMaintenanceValueRow;
}) {
  const { category, maintenance, customValue } = params;

  if (category.field_key === 'tax_due_date') return { dueDate: maintenance?.tax_due_date || null, dueMileage: null, lastMileage: null, dueHours: null, lastHours: null };
  if (category.field_key === 'mot_due_date') return { dueDate: maintenance?.mot_due_date || null, dueMileage: null, lastMileage: null, dueHours: null, lastHours: null };
  if (category.field_key === 'first_aid_kit_expiry') return { dueDate: maintenance?.first_aid_kit_expiry || null, dueMileage: null, lastMileage: null, dueHours: null, lastHours: null };
  if (category.field_key === 'six_weekly_inspection_due_date') return { dueDate: maintenance?.six_weekly_inspection_due_date || null, dueMileage: null, lastMileage: null, dueHours: null, lastHours: null };
  if (category.field_key === 'fire_extinguisher_due_date') return { dueDate: maintenance?.fire_extinguisher_due_date || null, dueMileage: null, lastMileage: null, dueHours: null, lastHours: null };
  if (category.field_key === 'taco_calibration_due_date') return { dueDate: maintenance?.taco_calibration_due_date || null, dueMileage: null, lastMileage: null, dueHours: null, lastHours: null };
  if (category.field_key === 'loler_due_date') return { dueDate: params.lolerDueDate, dueMileage: null, lastMileage: null, dueHours: null, lastHours: null };
  if (category.field_key === 'next_service_mileage') return { dueDate: null, dueMileage: maintenance?.next_service_mileage ?? null, lastMileage: maintenance?.last_service_mileage ?? null, dueHours: null, lastHours: null };
  if (category.field_key === 'cambelt_due_mileage') return { dueDate: null, dueMileage: maintenance?.cambelt_due_mileage ?? null, lastMileage: null, dueHours: null, lastHours: null };
  if (category.field_key === 'next_service_hours') return { dueDate: null, dueMileage: null, lastMileage: null, dueHours: maintenance?.next_service_hours ?? null, lastHours: maintenance?.last_service_hours ?? null };

  return {
    dueDate: customValue?.due_date || null,
    dueMileage: customValue?.due_mileage ?? null,
    lastMileage: customValue?.last_mileage ?? null,
    dueHours: customValue?.due_hours ?? null,
    lastHours: customValue?.last_hours ?? null,
  };
}

function formatMaintenanceItemValue(itemType: MaintenanceCategory['type'], values: ReturnType<typeof getDueValuesForCategory>): string {
  if (itemType === 'date') return values.dueDate ? new Date(values.dueDate).toLocaleDateString('en-GB') : 'Not set';
  if (itemType === 'hours') return values.dueHours == null ? 'Not set' : `${values.dueHours.toLocaleString()} hrs`;
  return values.dueMileage == null ? 'Not set' : values.dueMileage.toLocaleString();
}

function buildMaintenanceItems(params: {
  assetType: 'van' | 'hgv' | 'plant';
  assetId: string;
  categories: MaintenanceCategory[];
  maintenance: MaintenanceRow | null;
  lolerDueDate: string | null;
  customValuesByAsset: Map<string, CustomMaintenanceValueRow[]>;
}): MaintenanceItem[] {
  const assetValues = params.customValuesByAsset.get(getAssetValueKey(params.assetType, params.assetId)) || [];
  const valuesByCategoryId = new Map(assetValues.map(value => [value.maintenance_category_id, value]));

  return params.categories
    .filter(category => category.is_active !== false)
    .filter(category => categoryAppliesToAsset(category, params.assetType, category.name))
    .map(category => {
      const customValue = valuesByCategoryId.get(category.id);
      const status = getStatusForCategory({
        category,
        maintenance: params.maintenance,
        lolerDueDate: params.lolerDueDate,
        customValue,
      });
      const values = getDueValuesForCategory({
        category,
        maintenance: params.maintenance,
        lolerDueDate: params.lolerDueDate,
        customValue,
      });

      return {
        id: `${params.assetId}:${category.id}`,
        category_id: category.id,
        category_name: category.name,
        category_type: category.type,
        category_field_key: category.field_key || null,
        source: category.field_key ? 'system' : 'custom',
        is_system: category.is_system ?? false,
        is_delete_protected: category.is_delete_protected ?? false,
        sort_order: category.sort_order,
        asset_type: params.assetType,
        status,
        due_date: values.dueDate,
        due_mileage: values.dueMileage,
        last_mileage: values.lastMileage,
        due_hours: values.dueHours ?? null,
        last_hours: values.lastHours ?? null,
        display_value: formatMaintenanceItemValue(category.type, values),
        display_unit: category.type === 'date' ? 'date' : category.type === 'hours' ? 'hours' : getDistanceUnitLabel(params.assetType),
        value_id: customValue?.id || null,
      } satisfies MaintenanceItem;
    })
    .sort((a, b) => a.sort_order - b.sort_order || a.category_name.localeCompare(b.category_name));
}

export function normalizeDisplayBoardSettings(input: {
  fallback_poll_interval_seconds?: unknown;
  realtime_debounce_ms?: unknown;
  is_enabled?: unknown;
}, current: DisplayBoardConfig): Pick<DisplayBoardConfig, 'fallback_poll_interval_seconds' | 'realtime_debounce_ms' | 'is_enabled'> {
  return {
    fallback_poll_interval_seconds: clampNumber(input.fallback_poll_interval_seconds, current.fallback_poll_interval_seconds, 15, 300),
    realtime_debounce_ms: clampNumber(input.realtime_debounce_ms, current.realtime_debounce_ms, 250, 5000),
    is_enabled: typeof input.is_enabled === 'boolean' ? input.is_enabled : current.is_enabled,
  };
}

export async function loadDisplayBoardConfig(boardKey = WORKSHOP_DISPLAY_BOARD_KEY): Promise<DisplayBoardConfig> {
  const admin = getAdmin();
  const { data, error } = await admin
    .from('display_board_configs')
    .select('*')
    .eq('board_key', boardKey)
    .maybeSingle();

  if (error) throw error;
  if (data) return data as DisplayBoardConfig;

  const { data: inserted, error: insertError } = await admin
    .from('display_board_configs')
    .insert({
      board_key: boardKey,
      name: boardKey === WORKSHOP_DISPLAY_BOARD_KEY ? 'Workshop Display Board' : boardKey,
    })
    .select('*')
    .single();

  if (insertError) throw insertError;
  return inserted as DisplayBoardConfig;
}

async function expireStalePairingSessions(admin: AnySupabaseClient, boardKey = WORKSHOP_DISPLAY_BOARD_KEY) {
  await admin
    .from('display_board_pairing_sessions')
    .update({ status: 'expired' })
    .eq('board_key', boardKey)
    .eq('status', 'active')
    .lt('expires_at', new Date().toISOString());
}

export async function getDisplayBoardAdminState(boardKey = WORKSHOP_DISPLAY_BOARD_KEY): Promise<DisplayBoardAdminState> {
  const admin = getAdmin();
  const config = await loadDisplayBoardConfig(boardKey);
  await expireStalePairingSessions(admin, boardKey);

  const [{ data: pairings, error: pairingError }, { data: devices, error: deviceError }] = await Promise.all([
    admin
      .from('display_board_pairing_sessions')
      .select('*')
      .eq('board_key', boardKey)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1),
    admin
      .from('display_board_devices')
      .select('*')
      .eq('board_key', boardKey)
      .is('revoked_at', null)
      .order('created_at', { ascending: false }),
  ]);

  if (pairingError) throw pairingError;
  if (deviceError) throw deviceError;

  return {
    config,
    active_pairing: ((pairings || [])[0] || null) as DisplayBoardPairingSession | null,
    devices: ((devices || []) as DisplayBoardDevice[]).map((device) => ({
      ...device,
      display_text_size_step: normalizeDisplayBoardTextSizeStep(device.display_text_size_step),
    })),
  };
}

export async function updateDisplayBoardConfig(input: {
  fallback_poll_interval_seconds?: unknown;
  realtime_debounce_ms?: unknown;
  is_enabled?: unknown;
}, boardKey = WORKSHOP_DISPLAY_BOARD_KEY) {
  const current = await loadDisplayBoardConfig(boardKey);
  const nextSettings = normalizeDisplayBoardSettings(input, current);
  const admin = getAdmin();
  const { data, error } = await admin
    .from('display_board_configs')
    .update(nextSettings)
    .eq('board_key', boardKey)
    .select('*')
    .single();

  if (error) throw error;
  return data as DisplayBoardConfig;
}

export async function startDisplayBoardPairing(userId: string, boardKey = WORKSHOP_DISPLAY_BOARD_KEY) {
  const admin = getAdmin();
  await expireStalePairingSessions(admin, boardKey);
  await admin
    .from('display_board_pairing_sessions')
    .update({ status: 'cancelled' })
    .eq('board_key', boardKey)
    .eq('status', 'active');

  const expiresAt = new Date(Date.now() + DISPLAY_BOARD_PAIRING_WINDOW_MS).toISOString();
  const { data, error } = await admin
    .from('display_board_pairing_sessions')
    .insert({
      board_key: boardKey,
      started_by: userId,
      expires_at: expiresAt,
      status: 'active',
    })
    .select('*')
    .single();

  if (error) throw error;
  return data as DisplayBoardPairingSession;
}

export async function cancelDisplayBoardPairing(boardKey = WORKSHOP_DISPLAY_BOARD_KEY) {
  const admin = getAdmin();
  const { error } = await admin
    .from('display_board_pairing_sessions')
    .update({ status: 'cancelled' })
    .eq('board_key', boardKey)
    .eq('status', 'active');
  if (error) throw error;
}

export async function createDisplayBoardPairingCandidate(boardKey = WORKSHOP_DISPLAY_BOARD_KEY): Promise<DisplayBoardPairingResponse> {
  const admin = getAdmin();
  const config = await loadDisplayBoardConfig(boardKey);
  if (!config.is_enabled) {
    return { status: 'unavailable', message: 'Display board access is currently disabled.' };
  }

  await expireStalePairingSessions(admin, boardKey);
  const { data: sessions, error } = await admin
    .from('display_board_pairing_sessions')
    .select('*')
    .eq('board_key', boardKey)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw error;
  const session = (sessions || [])[0] as DisplayBoardPairingSession | undefined;
  if (!session) {
    return { status: 'unavailable', message: 'This display board is not authorised yet.' };
  }

  if (session.confirmation_code && session.pairing_token_hash) {
    return {
      status: 'pairing',
      confirmation_code: session.confirmation_code,
      expires_at: session.expires_at,
    };
  }

  const confirmationCode = randomConfirmationCode();
  const pairingToken = randomToken();
  const { data: updated, error: updateError } = await admin
    .from('display_board_pairing_sessions')
    .update({
      confirmation_code: confirmationCode,
      confirmation_code_hash: hashSecret(confirmationCode),
      pairing_token_hash: hashSecret(pairingToken),
      candidate_seen_at: new Date().toISOString(),
    })
    .eq('id', session.id)
    .eq('status', 'active')
    .select('*')
    .single();

  if (updateError) throw updateError;
  return {
    status: 'pairing',
    confirmation_code: (updated as DisplayBoardPairingSession).confirmation_code || confirmationCode,
    pairing_token: pairingToken,
    expires_at: (updated as DisplayBoardPairingSession).expires_at,
  };
}

export async function checkDisplayBoardPairing(pairingToken: string, boardKey = WORKSHOP_DISPLAY_BOARD_KEY): Promise<DisplayBoardPairingResponse> {
  if (!pairingToken) return { status: 'unavailable' };

  const admin = getAdmin();
  await expireStalePairingSessions(admin, boardKey);
  const { data: sessions, error } = await admin
    .from('display_board_pairing_sessions')
    .select('*')
    .eq('board_key', boardKey)
    .eq('pairing_token_hash', hashSecret(pairingToken))
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw error;
  const session = (sessions || [])[0] as DisplayBoardPairingSession | undefined;
  if (!session || session.status === 'cancelled' || session.status === 'expired') {
    return { status: 'expired' };
  }

  if (session.status !== 'confirmed') {
    return {
      status: 'pairing',
      confirmation_code: session.confirmation_code || undefined,
      expires_at: session.expires_at,
    };
  }

  const { data: devices, error: deviceError } = await admin
    .from('display_board_devices')
    .select('device_token_hash')
    .eq('pairing_session_id', session.id)
    .is('revoked_at', null)
    .limit(1);

  if (deviceError) throw deviceError;
  const tokenHash = (devices || [])[0]?.device_token_hash;
  if (!tokenHash) return { status: 'expired' };

  return { status: 'paired', device_token: pairingToken };
}

export async function confirmDisplayBoardPairing(userId: string, sessionId: string, confirmationCode: string, boardKey = WORKSHOP_DISPLAY_BOARD_KEY) {
  const admin = getAdmin();
  await expireStalePairingSessions(admin, boardKey);
  const { data: session, error } = await admin
    .from('display_board_pairing_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('board_key', boardKey)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (error) throw error;
  if (!session) throw new Error('Pairing session has expired or cannot be found.');

  const pairing = session as DisplayBoardPairingSession & { pairing_token_hash?: string | null; confirmation_code_hash?: string | null };
  if (!pairing.confirmation_code_hash || hashSecret(confirmationCode) !== pairing.confirmation_code_hash) {
    throw new Error('Confirmation code does not match.');
  }

  if (!pairing.pairing_token_hash) {
    throw new Error('No display board browser has joined this pairing session yet.');
  }

  const now = new Date().toISOString();
  const { error: deviceError } = await admin
    .from('display_board_devices')
    .insert({
      board_key: boardKey,
      device_token_hash: pairing.pairing_token_hash,
      label: `Workshop display ${new Date().toLocaleDateString('en-GB')}`,
      display_text_size_step: DISPLAY_BOARD_TEXT_SIZE_DEFAULT_STEP,
      paired_by: userId,
      pairing_session_id: pairing.id,
      last_seen_at: now,
    });

  if (deviceError) throw deviceError;

  const { error: sessionError } = await admin
    .from('display_board_pairing_sessions')
    .update({
      status: 'confirmed',
      confirmed_by: userId,
      confirmed_at: now,
    })
    .eq('id', pairing.id);

  if (sessionError) throw sessionError;
}

export async function updateDisplayBoardDeviceTextSize(
  deviceId: string,
  textSizeStep: unknown,
  boardKey = WORKSHOP_DISPLAY_BOARD_KEY
) {
  const admin = getAdmin();
  const { error } = await admin
    .from('display_board_devices')
    .update({
      display_text_size_step: normalizeDisplayBoardTextSizeStep(textSizeStep),
    })
    .eq('id', deviceId)
    .eq('board_key', boardKey)
    .is('revoked_at', null);

  if (error) throw error;

  const normalizedTextSizeStep = normalizeDisplayBoardTextSizeStep(textSizeStep);
  await notifyDisplayBoardDevice(boardKey, deviceId, {
    kind: 'text_size',
    text_size_step: normalizedTextSizeStep,
  });
}

export async function revokeDisplayBoardDevice(deviceId: string, userId: string, boardKey = WORKSHOP_DISPLAY_BOARD_KEY) {
  const admin = getAdmin();
  const { error } = await admin
    .from('display_board_devices')
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by: userId,
    })
    .eq('id', deviceId)
    .eq('board_key', boardKey)
    .is('revoked_at', null);
  if (error) throw error;

  await notifyDisplayBoardDevice(boardKey, deviceId, { kind: 'revoke' });
}

export async function validateDisplayBoardDeviceToken(deviceToken: string | null, boardKey = WORKSHOP_DISPLAY_BOARD_KEY) {
  if (!deviceToken) return null;
  const admin = getAdmin();
  const { data, error } = await admin
    .from('display_board_devices')
    .select('*')
    .eq('board_key', boardKey)
    .eq('device_token_hash', hashSecret(deviceToken))
    .is('revoked_at', null)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  await admin
    .from('display_board_devices')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', (data as DisplayBoardDevice).id);

  return {
    ...(data as DisplayBoardDevice),
    display_text_size_step: normalizeDisplayBoardTextSizeStep((data as DisplayBoardDevice).display_text_size_step),
  };
}

export async function buildMaintenanceListResponse(): Promise<MaintenanceListResponse> {
  const admin = getAdmin();
  const { data: categories, error: categoriesError } = await admin
    .from('maintenance_categories')
    .select('*')
    .order('sort_order');

  if (categoriesError) {
    logger.error('Failed to fetch maintenance categories', categoriesError);
    throw categoriesError;
  }

  const maintenanceCategories = (categories || []) as MaintenanceCategory[];
  const categoryMap = createMaintenanceCategoryMap(maintenanceCategories);
  const taxThreshold = getMaintenanceCategory(categoryMap, MAINTENANCE_CATEGORY_NAMES.tax)?.alert_threshold_days || 30;
  const motThreshold = getMaintenanceCategory(categoryMap, MAINTENANCE_CATEGORY_NAMES.mot)?.alert_threshold_days || 30;
  const serviceThreshold = getMaintenanceCategory(categoryMap, MAINTENANCE_CATEGORY_NAMES.service)?.alert_threshold_miles || 1000;
  const cambeltThreshold = getMaintenanceCategory(categoryMap, MAINTENANCE_CATEGORY_NAMES.cambelt)?.alert_threshold_miles || 5000;
  const firstAidThreshold = getMaintenanceCategory(categoryMap, MAINTENANCE_CATEGORY_NAMES.firstAid)?.alert_threshold_days || 30;
  const sixWeeklyThreshold = getMaintenanceCategory(categoryMap, MAINTENANCE_CATEGORY_NAMES.sixWeekly)?.alert_threshold_days || 7;
  const fireExtinguisherThreshold = getMaintenanceCategory(categoryMap, MAINTENANCE_CATEGORY_NAMES.fireExtinguisher)?.alert_threshold_days || 30;
  const tacoCalibrationThreshold = getMaintenanceCategory(categoryMap, MAINTENANCE_CATEGORY_NAMES.tacoCalibration)?.alert_threshold_days || 60;
  const lolerThreshold = getMaintenanceCategory(categoryMap, MAINTENANCE_CATEGORY_NAMES.loler)?.alert_threshold_days || 30;
  const serviceHoursThreshold = getMaintenanceCategory(categoryMap, MAINTENANCE_CATEGORY_NAMES.serviceHours)?.alert_threshold_hours || 50;

  const [vansResult, hgvsResult, plantResult, customValuesResult] = await Promise.all([
    admin.from('vans').select('id, reg_number, category_id, status, nickname, maintenance:vehicle_maintenance!van_id(*)').eq('status', 'active'),
    admin.from('hgvs').select('id, reg_number, category_id, status, nickname, maintenance:vehicle_maintenance!hgv_id(*)').eq('status', 'active'),
    admin.from('plant').select('id, plant_id, reg_number, nickname, serial_number, year, weight_class, category_id, status, loler_due_date, maintenance:vehicle_maintenance!plant_id(*)').eq('status', 'active'),
    admin.from('asset_maintenance_category_values').select('*'),
  ]);

  if (vansResult.error) throw vansResult.error;
  if (hgvsResult.error) throw hgvsResult.error;
  if (plantResult.error) throw plantResult.error;
  if (customValuesResult.error) throw customValuesResult.error;

  const customValuesByAsset = ((customValuesResult.data || []) as CustomMaintenanceValueRow[]).reduce(
    (map, value) => {
      const assetKey = getCustomValueAssetKey(value);
      if (!assetKey) return map;
      const assetValues = map.get(assetKey) || [];
      assetValues.push(value);
      map.set(assetKey, assetValues);
      return map;
    },
    new Map<string, CustomMaintenanceValueRow[]>()
  );

  const taggedAssets: TaggedAsset[] = [
    ...(vansResult.data || []).map((asset: Record<string, unknown>) => ({ ...asset, _assetType: 'van' as const })) as TaggedAsset[],
    ...(hgvsResult.data || []).map((asset: Record<string, unknown>) => ({ ...asset, _assetType: 'hgv' as const })) as TaggedAsset[],
    ...(plantResult.data || []).map((asset: Record<string, unknown>) => ({ ...asset, _assetType: 'plant' as const })) as TaggedAsset[],
  ];

  const vehiclesWithStatus = taggedAssets.map(asset => {
    const assetType = asset._assetType;
    const maintenance = (Array.isArray(asset.maintenance) ? asset.maintenance[0] : asset.maintenance) as MaintenanceRow | null;
    const vehicleObj = {
      id: asset.id,
      reg_number: asset.reg_number || null,
      category_id: asset.category_id || null,
      status: asset.status,
      nickname: asset.nickname || null,
      asset_type: assetType as 'van' | 'hgv' | 'plant',
      plant_id: asset.plant_id || null,
      serial_number: asset.serial_number || null,
      year: asset.year || null,
      weight_class: asset.weight_class || null,
    };
    const lolerDueDate = assetType === 'plant' ? (asset.loler_due_date || null) : null;
    const lolerStatus = assetType === 'plant' ? getDateBasedStatus(lolerDueDate, lolerThreshold) : { status: 'not_set' as const };
    const maintenanceItems = buildMaintenanceItems({
      assetType,
      assetId: asset.id,
      categories: maintenanceCategories,
      maintenance,
      lolerDueDate,
      customValuesByAsset,
    });
    const alertCounts = calculateAlertCounts(
      maintenanceItems
        .filter(item => isMaintenanceCategoryVisibleOnOverview(
          maintenanceCategories.find(category => category.id === item.category_id),
          assetType,
          item.category_name
        ))
        .map(item => item.status)
    );

    if (!maintenance) {
      return {
        id: null,
        van_id: assetType === 'van' ? asset.id : null,
        hgv_id: assetType === 'hgv' ? asset.id : null,
        plant_id: assetType === 'plant' ? asset.id : null,
        is_plant: assetType === 'plant',
        vehicle: vehicleObj,
        current_mileage: null,
        current_hours: null,
        tax_due_date: null,
        mot_due_date: null,
        next_service_mileage: null,
        last_service_mileage: null,
        next_service_hours: null,
        last_service_hours: null,
        cambelt_due_mileage: null,
        tracker_id: null,
        first_aid_kit_expiry: null,
        six_weekly_inspection_due_date: null,
        fire_extinguisher_due_date: null,
        taco_calibration_due_date: null,
        loler_due_date: lolerDueDate,
        created_at: null,
        updated_at: null,
        last_updated_by: null,
        last_updated_at: '',
        last_mileage_update: null,
        notes: null,
        tax_status: { status: 'not_set' as const },
        mot_status: { status: 'not_set' as const },
        service_status: { status: 'not_set' as const },
        cambelt_status: { status: 'not_set' as const },
        first_aid_status: { status: 'not_set' as const },
        six_weekly_status: { status: 'not_set' as const },
        fire_extinguisher_status: { status: 'not_set' as const },
        taco_calibration_status: { status: 'not_set' as const },
        loler_status: lolerStatus,
        service_hours_status: { status: 'not_set' as const },
        maintenance_items: maintenanceItems,
        overdue_count: alertCounts.overdue,
        due_soon_count: alertCounts.due_soon,
      };
    }

    return {
      ...maintenance,
      is_plant: assetType === 'plant',
      vehicle: vehicleObj,
      tax_status: getDateBasedStatus(maintenance.tax_due_date, taxThreshold),
      mot_status: getDateBasedStatus(maintenance.mot_due_date, motThreshold),
      service_status: getMileageBasedStatus(maintenance.current_mileage, maintenance.next_service_mileage, serviceThreshold),
      cambelt_status: getMileageBasedStatus(maintenance.current_mileage, maintenance.cambelt_due_mileage, cambeltThreshold),
      first_aid_status: getDateBasedStatus(maintenance.first_aid_kit_expiry, firstAidThreshold),
      six_weekly_status: getDateBasedStatus(maintenance.six_weekly_inspection_due_date, sixWeeklyThreshold),
      fire_extinguisher_status: getDateBasedStatus(maintenance.fire_extinguisher_due_date, fireExtinguisherThreshold),
      taco_calibration_status: getDateBasedStatus(maintenance.taco_calibration_due_date, tacoCalibrationThreshold),
      loler_status: lolerStatus,
      loler_due_date: lolerDueDate,
      service_hours_status: assetType === 'plant'
        ? getHoursBasedStatus(maintenance.current_hours, maintenance.next_service_hours, serviceHoursThreshold)
        : { status: 'not_set' as const },
      maintenance_items: maintenanceItems,
      overdue_count: alertCounts.overdue,
      due_soon_count: alertCounts.due_soon,
    };
  }) as VehicleMaintenanceWithStatus[];

  return {
    success: true,
    vehicles: vehiclesWithStatus,
    summary: {
      total: vehiclesWithStatus.length,
      overdue: vehiclesWithStatus.filter(vehicle => vehicle.overdue_count > 0).length,
      due_soon: vehiclesWithStatus.filter(vehicle => vehicle.due_soon_count > 0 && vehicle.overdue_count === 0).length,
    },
  };
}

function buildMaintenanceBoardItems(vehicles: VehicleMaintenanceWithStatus[], status: 'overdue' | 'due_soon') {
  return vehicles
    .flatMap(vehicle => {
      const asset = vehicle.vehicle;
      const assetType = asset?.asset_type || 'vehicle';
      const assetName = getAssetLabel(asset);
      return (vehicle.maintenance_items || [])
        .filter(item => item.status.status === status)
        .map(item => ({
          id: `${asset?.id || vehicle.id}:${item.category_id}:${status}`,
          asset: assetName,
          asset_type: assetType,
          category: item.category_name,
          status,
          detail: item.display_value || 'Attention required',
        } satisfies DisplayBoardMaintenanceItem));
    })
    .slice(0, 14);
}

async function loadWorkshopTasksForBoard() {
  const admin = getAdmin();
  const { data, error } = await admin
    .from('actions')
    .select(`
      id,
      status,
      action_type,
      inspection_id,
      van_id,
      hgv_id,
      plant_id,
      title,
      description,
      workshop_comments,
      created_at,
      vans (reg_number, nickname),
      hgvs (reg_number, nickname),
      plant (plant_id, nickname),
      workshop_task_categories (name),
      workshop_task_subcategories!workshop_subcategory_id (
        name,
        workshop_task_categories (name)
      )
    `)
    .in('action_type', ['inspection_defect', 'workshop_vehicle_task'])
    .in('status', ['pending', 'logged', 'on_hold'])
    .order('created_at', { ascending: false });

  if (error) throw error;
  let rows = (data || []) as unknown as WorkshopTaskRow[];
  const inspectionIdsNeedingAsset = Array.from(
    new Set(
      rows
        .filter(task => Boolean(task.inspection_id) && !task.van_id && !task.hgv_id && !task.plant_id)
        .map(task => task.inspection_id as string)
    )
  );

  if (inspectionIdsNeedingAsset.length > 0) {
    const [
      { data: vanInspectionRows, error: vanInspectionError },
      { data: hgvInspectionRows, error: hgvInspectionError },
      { data: plantInspectionRows, error: plantInspectionError },
    ] = await Promise.all([
      admin
        .from('van_inspections')
        .select(`
          id,
          van_id,
          vans (
            reg_number,
            nickname
          )
        `)
        .in('id', inspectionIdsNeedingAsset),
      admin
        .from('hgv_inspections')
        .select(`
          id,
          hgv_id,
          hgvs (
            reg_number,
            nickname
          )
        `)
        .in('id', inspectionIdsNeedingAsset),
      admin
        .from('plant_inspections')
        .select(`
          id,
          plant_id,
          plant (
            plant_id,
            nickname
          )
        `)
        .in('id', inspectionIdsNeedingAsset),
    ]);

    if (vanInspectionError) throw vanInspectionError;
    if (hgvInspectionError) throw hgvInspectionError;
    if (plantInspectionError) throw plantInspectionError;

    const vanByInspectionId = new Map(
      ((vanInspectionRows || []) as unknown as Array<{
        id: string;
        van_id: string | null;
        vans: { reg_number: string | null; nickname: string | null } | Array<{ reg_number: string | null; nickname: string | null }> | null;
      }>).map(row => [row.id, row])
    );
    const hgvByInspectionId = new Map(
      ((hgvInspectionRows || []) as unknown as Array<{
        id: string;
        hgv_id: string | null;
        hgvs: { reg_number: string | null; nickname: string | null } | Array<{ reg_number: string | null; nickname: string | null }> | null;
      }>).map(row => [row.id, row])
    );
    const plantByInspectionId = new Map(
      ((plantInspectionRows || []) as unknown as Array<{
        id: string;
        plant_id: string | null;
        plant: { plant_id: string | null; nickname: string | null } | Array<{ plant_id: string | null; nickname: string | null }> | null;
      }>).map(row => [row.id, row])
    );

    rows = rows.map((task) => {
      if (task.van_id || task.hgv_id || task.plant_id || !task.inspection_id) {
        return task;
      }

      const vanFallback = vanByInspectionId.get(task.inspection_id);
      if (vanFallback?.van_id) {
        return {
          ...task,
          van_id: vanFallback.van_id,
          vans: task.vans || vanFallback.vans,
        };
      }

      const hgvFallback = hgvByInspectionId.get(task.inspection_id);
      if (hgvFallback?.hgv_id) {
        return {
          ...task,
          hgv_id: hgvFallback.hgv_id,
          hgvs: task.hgvs || hgvFallback.hgvs,
        };
      }

      const plantFallback = plantByInspectionId.get(task.inspection_id);
      if (plantFallback?.plant_id) {
        return {
          ...task,
          plant_id: plantFallback.plant_id,
          plant: task.plant || plantFallback.plant,
        };
      }

      return task;
    });
  }

  const mapTask = (task: WorkshopTaskRow): DisplayBoardWorkshopTask => {
    const van = singleRelation(task.vans);
    const hgv = singleRelation(task.hgvs);
    const plant = singleRelation(task.plant);
    const categoryRow = singleRelation(task.workshop_task_categories);
    const subcategoryRow = singleRelation(task.workshop_task_subcategories);
    const subcategoryCategory = singleRelation(subcategoryRow?.workshop_task_categories);
    const asset = van
      ? getAssetLabel(van)
      : hgv
        ? getAssetLabel(hgv)
        : plant
          ? getAssetLabel(plant)
          : 'Unknown';
    const category = subcategoryCategory?.name
      || categoryRow?.name
      || subcategoryRow?.name
      || null;

    return {
      id: task.id,
      asset,
      status: task.status as 'pending' | 'logged' | 'on_hold',
      source: task.action_type === 'inspection_defect' ? 'Daily Check Defect' : 'Workshop Task',
      category,
      summary: (task.description || task.workshop_comments || task.title || '').trim() || 'Workshop attention required',
      created_at: task.created_at,
      is_high_priority: task.action_type === 'inspection_defect' && Boolean(task.hgv_id),
    };
  };

  const pending = rows.filter(task => task.status === 'pending').map(mapTask);
  const inProgress = rows.filter(task => task.status === 'logged').map(mapTask);
  const onHold = rows.filter(task => task.status === 'on_hold').map(mapTask);

  return {
    counts: {
      pending: pending.length,
      in_progress: inProgress.length,
      on_hold: onHold.length,
      high_priority: pending.filter(task => task.is_high_priority).length,
    },
    pending: pending.sort((a, b) => Number(b.is_high_priority) - Number(a.is_high_priority)).slice(0, 12),
    in_progress: inProgress.slice(0, 10),
    on_hold: onHold.slice(0, 10),
  };
}

export async function buildDisplayBoardPayload(deviceToken: string | null, boardKey = WORKSHOP_DISPLAY_BOARD_KEY): Promise<DisplayBoardPayload | null> {
  const [config, device] = await Promise.all([
    loadDisplayBoardConfig(boardKey),
    validateDisplayBoardDeviceToken(deviceToken, boardKey),
  ]);

  if (!config.is_enabled || !device) {
    return null;
  }

  const [maintenanceData, workshop] = await Promise.all([
    buildMaintenanceListResponse(),
    loadWorkshopTasksForBoard(),
  ]);

  return {
    config,
    device: {
      id: device.id,
    },
    display: {
      text_size_step: normalizeDisplayBoardTextSizeStep(device.display_text_size_step),
    },
    maintenance: {
      summary: maintenanceData.summary,
      overdue_items: buildMaintenanceBoardItems(maintenanceData.vehicles, 'overdue'),
      due_soon_items: buildMaintenanceBoardItems(maintenanceData.vehicles, 'due_soon'),
    },
    workshop,
    generated_at: new Date().toISOString(),
  };
}
