'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, Archive, Download, Edit, GraduationCap, Loader2, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageLoader } from '@/components/ui/page-loader';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadMorePagination } from '@/components/ui/load-more-pagination';
import { fetchAllPaginatedItems } from '@/lib/client/paginated-fetch';
import { useLoadMorePagination } from '@/lib/hooks/useLoadMorePagination';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { useSoftRefresh } from '@/lib/hooks/useSoftRefresh';
import {
  TRAINING_VALIDATION_STATUS_OPTIONS,
  type TrainingPerson,
  type TrainingPersonFormData,
  type TrainingQualification,
  type TrainingQualificationFormData,
  type TrainingRecordFormData,
  type TrainingRecordWithRelations,
  type TrainingSummary,
  type TrainingWorkbookNote,
} from '@/types/training';
import { TrainingRecordDialog } from './components/TrainingRecordDialog';
import { TrainingPersonDialog } from './components/TrainingPersonDialog';
import { TrainingQualificationDialog } from './components/TrainingQualificationDialog';

type TrainingTab = 'overview' | 'records' | 'people' | 'qualifications' | 'notes';
type TrainingSlice = 'summary' | 'records' | 'people' | 'qualifications' | 'notes';
type RecordFilter = 'all' | 'expired' | 'expiring' | 'no_expiry' | 'needs_nvq' | 'awaiting_card' | 'training_booked' | 'manual_review' | 'subcontractors' | 'unlinked' | 'archived';

const TRAINING_SLICES: readonly TrainingSlice[] = ['summary', 'records', 'people', 'qualifications', 'notes'];

const TAB_SLICES: Record<TrainingTab, readonly TrainingSlice[]> = {
  overview: ['summary', 'records'],
  records: ['summary', 'records'],
  people: ['summary', 'people'],
  qualifications: ['summary', 'qualifications'],
  notes: ['summary', 'notes'],
};

interface TrainingAccessKeyInput {
  userId: string | null;
  profileRoleName: string;
  profileTeamId: string;
  profileTeamName: string;
  isViewingAs: boolean;
  effectiveRoleName: string;
  effectiveTeamId: string;
  effectiveTeamName: string;
  hasPermission: boolean;
  permissionLoading: boolean;
}

function buildTrainingAccessKey(input: TrainingAccessKeyInput): string {
  if (input.permissionLoading || !input.hasPermission || !input.userId) return '';
  return JSON.stringify([
    input.userId,
    input.profileRoleName,
    input.profileTeamId,
    input.profileTeamName,
    input.isViewingAs,
    input.effectiveRoleName,
    input.effectiveTeamId,
    input.effectiveTeamName,
  ]);
}

interface TrainingOperationToken {
  generation: number;
  contextKey: string;
}

interface SliceStatus {
  loaded: boolean;
  loading: boolean;
  error: string | null;
}

interface SliceFlight {
  generation: number;
  contextKey: string;
  promise: Promise<void>;
}

interface TrainingPersonWithProfile extends TrainingPerson {
  profile?: {
    id: string;
    full_name: string | null;
    employee_id: string | null;
  } | null;
}

interface TrainingDataState {
  summary: TrainingSummary | null;
  records: TrainingRecordWithRelations[];
  people: TrainingPersonWithProfile[];
  qualifications: TrainingQualification[];
  notes: TrainingWorkbookNote[];
}

const EMPTY_TRAINING_DATA: TrainingDataState = {
  summary: null,
  records: [],
  people: [],
  qualifications: [],
  notes: [],
};

function createSliceStatus(): Record<TrainingSlice, SliceStatus> {
  return {
    summary: { loaded: false, loading: false, error: null },
    records: { loaded: false, loading: false, error: null },
    people: { loaded: false, loading: false, error: null },
    qualifications: { loaded: false, loading: false, error: null },
    notes: { loaded: false, loading: false, error: null },
  };
}

function createLoadedFlags(): Record<TrainingSlice, boolean> {
  return {
    summary: false,
    records: false,
    people: false,
    qualifications: false,
    notes: false,
  };
}

function createSliceGeneration(): Record<TrainingSlice, number> {
  return {
    summary: 0,
    records: 0,
    people: 0,
    qualifications: 0,
    notes: 0,
  };
}

const RECORD_FILTERS: Array<{ value: RecordFilter; label: string }> = [
  { value: 'all', label: 'All Active' },
  { value: 'expired', label: 'Expired' },
  { value: 'expiring', label: 'Expiring 90 Days' },
  { value: 'no_expiry', label: 'No Expiry' },
  { value: 'needs_nvq', label: 'Needs NVQ' },
  { value: 'awaiting_card', label: 'Awaiting Card' },
  { value: 'training_booked', label: 'Training Booked' },
  { value: 'manual_review', label: 'Manual Review' },
  { value: 'subcontractors', label: 'Subcontractors' },
  { value: 'unlinked', label: 'Unlinked People' },
  { value: 'archived', label: 'Archived' },
];

function formatDate(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB');
}

function formatStatusLabel(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getExpiryStatus(record: TrainingRecordWithRelations): 'expired' | 'expiring' | 'ok' | 'none' {
  if (!record.expiry_date) return 'none';
  const todayIso = new Date().toISOString().slice(0, 10);
  const soonDate = new Date();
  soonDate.setDate(soonDate.getDate() + 90);
  const soonIso = soonDate.toISOString().slice(0, 10);
  if (record.expiry_date < todayIso) return 'expired';
  if (record.expiry_date <= soonIso) return 'expiring';
  return 'ok';
}

function expiryBadgeClass(status: ReturnType<typeof getExpiryStatus>): string {
  if (status === 'expired') return 'border-red-500/30 bg-red-500/10 text-red-300';
  if (status === 'expiring') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  if (status === 'none') return 'border-slate-500/30 bg-slate-500/10 text-slate-300';
  return 'border-green-500/30 bg-green-500/10 text-green-300';
}

function includesSearch(haystack: Array<string | null | undefined>, query: string): boolean {
  if (!query) return true;
  return haystack.some((value) => (value || '').toLowerCase().includes(query));
}

function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(anchor);
}

async function parseJsonResponse(response: Response, fallbackMessage: string) {
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || fallbackMessage);
  }
  return payload;
}

function applySliceValue(current: TrainingDataState, slice: TrainingSlice, value: unknown): TrainingDataState {
  switch (slice) {
    case 'summary':
      return { ...current, summary: value as TrainingSummary };
    case 'records':
      return { ...current, records: value as TrainingRecordWithRelations[] };
    case 'people':
      return { ...current, people: value as TrainingPersonWithProfile[] };
    case 'qualifications':
      return { ...current, qualifications: value as TrainingQualification[] };
    case 'notes':
      return { ...current, notes: value as TrainingWorkbookNote[] };
    default:
      return current;
  }
}

async function fetchTrainingSlice(slice: TrainingSlice): Promise<unknown> {
  switch (slice) {
    case 'summary': {
      const response = await fetch('/api/training/summary', { cache: 'no-store' });
      const payload = await parseJsonResponse(response, 'Failed to fetch training summary') as { summary: TrainingSummary };
      return payload.summary;
    }
    case 'records':
      return (await fetchAllPaginatedItems<TrainingRecordWithRelations>('/api/training/records', 'records', { limit: 500, errorMessage: 'Failed to fetch training records' })).items;
    case 'people':
      return (await fetchAllPaginatedItems<TrainingPersonWithProfile>('/api/training/people', 'people', { limit: 500, errorMessage: 'Failed to fetch training people' })).items;
    case 'qualifications':
      return (await fetchAllPaginatedItems<TrainingQualification>('/api/training/qualifications', 'qualifications', { limit: 500, errorMessage: 'Failed to fetch training qualifications' })).items;
    case 'notes':
      return (await fetchAllPaginatedItems<TrainingWorkbookNote>('/api/training/notes', 'notes', { limit: 500, errorMessage: 'Failed to fetch training notes' })).items;
    default:
      return null;
  }
}

function SummaryCard({ label, value, description }: { label: string; value: number; description: string }) {
  return (
    <Card className="border-border bg-white dark:bg-slate-900">
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function TrainingDevelopmentBanner() {
  return (
    <Card className="border-amber-500/30 bg-amber-500/10">
      <CardContent className="flex items-start gap-3 p-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 flex-none text-amber-300" />
        <div>
          <div className="font-medium text-amber-100">Training module still in development</div>
          <p className="mt-1 text-sm text-amber-100/80">
            This module is being actively built. Data, filters, and workflows may change while final checks are completed.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function TrainingContent({
  contextKey,
  hasPermission,
  permissionLoading,
}: {
  contextKey: string;
  hasPermission: boolean;
  permissionLoading: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<TrainingDataState>(EMPTY_TRAINING_DATA);
  const [sliceStatus, setSliceStatus] = useState<Record<TrainingSlice, SliceStatus>>(createSliceStatus);
  const [refreshing, setRefreshing] = useState(false);
  const [recordSearch, setRecordSearch] = useState('');
  const [recordFilter, setRecordFilter] = useState<RecordFilter>('all');
  const [peopleSearch, setPeopleSearch] = useState('');
  const [qualificationSearch, setQualificationSearch] = useState('');
  const [qualificationStatus, setQualificationStatus] = useState('all');
  const [notesSearch, setNotesSearch] = useState('');
  const [exporting, setExporting] = useState(false);
  const [editingRecord, setEditingRecord] = useState<TrainingRecordWithRelations | null>(null);
  const [creatingRecord, setCreatingRecord] = useState(false);
  const [editingPerson, setEditingPerson] = useState<TrainingPersonWithProfile | null>(null);
  const [editingQualification, setEditingQualification] = useState<TrainingQualification | null>(null);
  const [archivingRecordId, setArchivingRecordId] = useState<string | null>(null);
  const loadedRef = useRef<Record<TrainingSlice, boolean>>(createLoadedFlags());
  const sliceGeneration = useRef<Record<TrainingSlice, number>>(createSliceGeneration());
  const sliceFlights = useRef<Partial<Record<TrainingSlice, SliceFlight>>>({});
  const contextKeyRef = useRef(contextKey);
  const liveGeneration = useRef(0);
  const appliedContextKey = useRef<string | null>(null);
  const refreshDepth = useRef(0);
  const ensureTabRef = useRef<(tab: TrainingTab) => Promise<void>>(async () => undefined);

  if (contextKeyRef.current !== contextKey) {
    contextKeyRef.current = contextKey;
  }

  function captureOperation(): TrainingOperationToken {
    return { generation: liveGeneration.current, contextKey: contextKeyRef.current };
  }

  function operationIsCurrent(token: TrainingOperationToken): boolean {
    return token.contextKey !== ''
      && liveGeneration.current === token.generation
      && contextKeyRef.current === token.contextKey;
  }

  function sliceResultIsCurrent(slice: TrainingSlice, generation: number, requestContextKey: string, operationGeneration: number): boolean {
    return sliceGeneration.current[slice] === generation
      && requestContextKey !== ''
      && contextKeyRef.current === requestContextKey
      && liveGeneration.current === operationGeneration;
  }

  const activeTab = (['overview', 'records', 'people', 'qualifications', 'notes'].includes(searchParams.get('tab') || '')
    ? searchParams.get('tab')
    : 'overview') as TrainingTab;
  const activeSliceErrors = TAB_SLICES[activeTab].filter((slice) => sliceStatus[slice].error);
  const activeTabLoading = TAB_SLICES[activeTab].some((slice) => !sliceStatus[slice].loaded && !sliceStatus[slice].error);

  function clearTrainingSlices() {
    loadedRef.current = createLoadedFlags();
    for (const slice of TRAINING_SLICES) {
      sliceGeneration.current[slice] += 1;
    }
    sliceFlights.current = {};
    refreshDepth.current = 0;
    setData(EMPTY_TRAINING_DATA);
    setSliceStatus(createSliceStatus());
    setRefreshing(false);
    setExporting(false);
    setEditingRecord(null);
    setCreatingRecord(false);
    setEditingPerson(null);
    setEditingQualification(null);
    setArchivingRecordId(null);
  }

  function requestSlice(slice: TrainingSlice, options: { join: boolean; background: boolean }): Promise<void> {
    const requestContextKey = contextKeyRef.current;
    if (!requestContextKey) return Promise.resolve();
    const existing = sliceFlights.current[slice];
    if (options.join && existing && existing.contextKey === requestContextKey) {
      return existing.promise;
    }

    const generation = sliceGeneration.current[slice] + 1;
    const operationGeneration = liveGeneration.current;
    sliceGeneration.current[slice] = generation;
    const promise = (async () => {
      if (!sliceResultIsCurrent(slice, generation, requestContextKey, operationGeneration)) return;
      setSliceStatus((current) => ({
        ...current,
        [slice]: { ...current[slice], loading: true, error: null },
      }));
      try {
        const value = await fetchTrainingSlice(slice);
        if (!sliceResultIsCurrent(slice, generation, requestContextKey, operationGeneration)) return;
        loadedRef.current[slice] = true;
        setData((current) => applySliceValue(current, slice, value));
        setSliceStatus((current) => ({
          ...current,
          [slice]: { loaded: true, loading: false, error: null },
        }));
      } catch (error) {
        if (!sliceResultIsCurrent(slice, generation, requestContextKey, operationGeneration)) return;
        const message = error instanceof Error ? error.message : 'Failed to load training data';
        setSliceStatus((current) => ({
          ...current,
          [slice]: { loaded: current[slice].loaded, loading: false, error: message },
        }));
        if (!options.background) toast.error(message);
      } finally {
        const flight = sliceFlights.current[slice];
        if (flight && flight.generation === generation && flight.contextKey === requestContextKey) {
          delete sliceFlights.current[slice];
        }
      }
    })();

    sliceFlights.current[slice] = { generation, contextKey: requestContextKey, promise };
    return promise;
  }

  async function refreshSlices(slices: readonly TrainingSlice[], options: { background: boolean; showRefreshing: boolean }) {
    const token = captureOperation();
    if (!operationIsCurrent(token)) return;
    if (options.showRefreshing) {
      refreshDepth.current += 1;
      setRefreshing(true);
    }
    try {
      await Promise.all(slices.map((slice) => requestSlice(slice, { join: false, background: options.background })));
    } finally {
      if (options.showRefreshing && operationIsCurrent(token)) {
        refreshDepth.current = Math.max(0, refreshDepth.current - 1);
        if (refreshDepth.current === 0) setRefreshing(false);
      }
    }
  }

  function refreshAll() {
    return refreshSlices(TRAINING_SLICES, { background: false, showRefreshing: true });
  }

  function slicesForMutation(always: readonly TrainingSlice[], ifLoaded: readonly TrainingSlice[]) {
    const slices: TrainingSlice[] = [];
    for (const slice of [...always, ...ifLoaded]) {
      if (slices.includes(slice)) continue;
      if (always.includes(slice) || loadedRef.current[slice]) slices.push(slice);
    }
    return slices;
  }

  ensureTabRef.current = (tab) => {
    const missing = TAB_SLICES[tab].filter((slice) => !loadedRef.current[slice]);
    return Promise.all(missing.map((slice) => requestSlice(slice, { join: true, background: false }))).then(() => undefined);
  };

  useEffect(() => {
    if (permissionLoading || hasPermission) return;
    toast.error('Access denied', { id: 'training-access-denied' });
    router.push('/dashboard');
  }, [hasPermission, permissionLoading, router]);

  useEffect(() => {
    const generations = sliceGeneration.current;
    contextKeyRef.current = contextKey;
    return () => {
      liveGeneration.current += 1;
      contextKeyRef.current = '';
      for (const slice of TRAINING_SLICES) {
        generations[slice] += 1;
      }
      sliceFlights.current = {};
    };
  }, [contextKey]);

  useEffect(() => {
    const previousKey = appliedContextKey.current;
    if (previousKey !== contextKey) {
      appliedContextKey.current = contextKey;
      contextKeyRef.current = contextKey;
      if (previousKey) {
        liveGeneration.current += 1;
        clearTrainingSlices();
      }
    }
    if (!contextKey) return;
    void ensureTabRef.current(activeTab);
  }, [activeTab, contextKey]);

  const trainingDraftOpen = Boolean(editingRecord)
    || creatingRecord
    || Boolean(editingPerson)
    || Boolean(editingQualification)
    || Boolean(archivingRecordId);

  useSoftRefresh(
    () => refreshSlices(
      TRAINING_SLICES.filter((slice) => slice === 'summary' || loadedRef.current[slice]),
      { background: true, showRefreshing: false }
    ),
    Boolean(contextKey) && hasPermission && !permissionLoading && !activeTabLoading && !refreshing && !exporting && !trainingDraftOpen
  );

  function setTab(tab: TrainingTab) {
    router.replace(`/training?tab=${tab}`, { scroll: false });
  }

  const filteredRecords = useMemo(() => {
    const query = recordSearch.trim().toLowerCase();
    return data.records.filter((record) => {
      const expiryStatus = getExpiryStatus(record);
      if (recordFilter === 'all' && record.record_status !== 'active') return false;
      if (recordFilter === 'archived' && record.record_status !== 'archived') return false;
      if (recordFilter === 'expired' && (record.record_status !== 'active' || expiryStatus !== 'expired')) return false;
      if (recordFilter === 'expiring' && (record.record_status !== 'active' || expiryStatus !== 'expiring')) return false;
      if (recordFilter === 'no_expiry' && (record.record_status !== 'active' || record.expiry_date)) return false;
      if (recordFilter === 'needs_nvq' && (record.record_status !== 'active' || !record.cpcs_statuses.includes('needs_nvq'))) return false;
      if (recordFilter === 'awaiting_card' && (record.record_status !== 'active' || !record.cpcs_statuses.includes('awaiting_card'))) return false;
      if (recordFilter === 'training_booked' && (record.record_status !== 'active' || !record.cpcs_statuses.includes('training_booked'))) return false;
      if (recordFilter === 'manual_review' && (record.record_status !== 'active' || record.qualification_validation_status !== 'needs_manual_review')) return false;
      if (recordFilter === 'subcontractors' && (record.record_status !== 'active' || record.relationship !== 'sub_contractor')) return false;
      if (recordFilter === 'unlinked' && (record.record_status !== 'active' || record.person?.profile_match_status === 'matched')) return false;

      return includesSearch([
        record.employee_name_raw,
        record.qualification_raw,
        record.qualification_canonical_proposed,
        record.card_number,
        record.source_sheet,
        record.comments,
      ], query);
    });
  }, [data.records, recordFilter, recordSearch]);

  const filteredPeople = useMemo(() => {
    const query = peopleSearch.trim().toLowerCase();
    return data.people.filter((person) => includesSearch([
      person.employee_name_raw,
      person.employee_key,
      person.profile?.full_name,
      person.profile_match_status,
      person.profile_match_notes,
    ], query));
  }, [data.people, peopleSearch]);

  const filteredQualifications = useMemo(() => {
    const query = qualificationSearch.trim().toLowerCase();
    return data.qualifications.filter((qualification) => {
      if (qualificationStatus !== 'all' && qualification.validation_status !== qualificationStatus) return false;
      return includesSearch([
        qualification.qualification_raw,
        qualification.canonical_name,
        qualification.validation_status,
        qualification.validation_notes,
      ], query);
    });
  }, [data.qualifications, qualificationSearch, qualificationStatus]);

  const filteredNotes = useMemo(() => {
    const query = notesSearch.trim().toLowerCase();
    return data.notes.filter((note) => includesSearch([
      note.source_sheet,
      note.cell_address,
      note.note_value,
      note.reason,
      note.note_type,
    ], query));
  }, [data.notes, notesSearch]);

  const priorityTrainingRecords = useMemo(() => data.records
    .filter((record) => record.record_status === 'active')
    .filter((record) => ['expired', 'expiring', 'none'].includes(getExpiryStatus(record)) || record.cpcs_statuses.length > 0)
    .slice(0, 10), [data.records]);

  const recordPagination = useLoadMorePagination(filteredRecords, { resetKey: `${recordFilter}:${recordSearch}:${filteredRecords.length}` });
  const peoplePagination = useLoadMorePagination(filteredPeople, { resetKey: `${peopleSearch}:${filteredPeople.length}` });
  const qualificationPagination = useLoadMorePagination(filteredQualifications, { resetKey: `${qualificationSearch}:${qualificationStatus}:${filteredQualifications.length}` });
  const notesPagination = useLoadMorePagination(filteredNotes, { resetKey: `${notesSearch}:${filteredNotes.length}` });

  async function saveRecord(form: TrainingRecordFormData) {
    const token = captureOperation();
    try {
      const target = editingRecord;
      const response = await fetch(target ? `/api/training/records/${target.id}` : '/api/training/records', {
        method: target ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      await parseJsonResponse(response, target ? 'Failed to update training record' : 'Failed to create training record');
      if (!operationIsCurrent(token)) return;
      toast.success(target ? 'Training record updated' : 'Training record created');
      setEditingRecord(null);
      setCreatingRecord(false);
      await refreshSlices(
        slicesForMutation(['summary', 'records'], ['people', 'qualifications']),
        { background: false, showRefreshing: true }
      );
    } catch (error) {
      if (operationIsCurrent(token)) throw error;
    }
  }

  async function archiveRecord(record: TrainingRecordWithRelations) {
    const token = captureOperation();
    if (!confirm(`Archive training record for ${record.employee_name_raw || 'this person'}?`)) return;
    setArchivingRecordId(record.id);
    try {
      const response = await fetch(`/api/training/records/${record.id}`, { method: 'DELETE' });
      await parseJsonResponse(response, 'Failed to archive training record');
      if (!operationIsCurrent(token)) return;
      toast.success('Training record archived');
      await refreshSlices(
        slicesForMutation(['summary', 'records'], ['people', 'qualifications']),
        { background: false, showRefreshing: true }
      );
    } catch (error) {
      if (operationIsCurrent(token)) toast.error(error instanceof Error ? error.message : 'Failed to archive training record');
    } finally {
      if (operationIsCurrent(token)) setArchivingRecordId(null);
    }
  }

  async function savePerson(form: TrainingPersonFormData) {
    const token = captureOperation();
    try {
      if (!editingPerson) return;
      const response = await fetch(`/api/training/people/${editingPerson.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      await parseJsonResponse(response, 'Failed to update training person');
      if (!operationIsCurrent(token)) return;
      toast.success('Training person updated');
      setEditingPerson(null);
      await refreshSlices(
        slicesForMutation(['summary'], ['people', 'records']),
        { background: false, showRefreshing: true }
      );
    } catch (error) {
      if (operationIsCurrent(token)) throw error;
    }
  }

  async function saveQualification(form: TrainingQualificationFormData) {
    const token = captureOperation();
    try {
      if (!editingQualification) return;
      const response = await fetch(`/api/training/qualifications/${editingQualification.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      await parseJsonResponse(response, 'Failed to update training qualification');
      if (!operationIsCurrent(token)) return;
      toast.success('Training qualification updated');
      setEditingQualification(null);
      await refreshSlices(
        slicesForMutation(['summary'], ['qualifications', 'records']),
        { background: false, showRefreshing: true }
      );
    } catch (error) {
      if (operationIsCurrent(token)) throw error;
    }
  }

  async function exportRecords() {
    const token = captureOperation();
    if (!operationIsCurrent(token)) return;
    setExporting(true);
    try {
      const response = await fetch('/api/reports/training/export?status=active', { cache: 'no-store' });
      if (!operationIsCurrent(token)) return;
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || 'Failed to export training records');
      }
      const blob = await response.blob();
      if (!operationIsCurrent(token)) return;
      downloadBlob(blob, `Training_Records_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (error) {
      if (!operationIsCurrent(token)) return;
      toast.error(error instanceof Error ? error.message : 'Failed to export training records');
    } finally {
      if (operationIsCurrent(token)) setExporting(false);
    }
  }

  if (permissionLoading || !hasPermission || !contextKey) {
    return <PageLoader message="Loading training..." />;
  }

  const summary = data.summary;

  return (
    <AppPageShell width="full">
      <AppPageHeader
        title="Training"
        description="Imported client training records with expiry tracking, source traceability, and manual admin updates."
        icon={<GraduationCap className="h-6 w-6" />}
        actions={
          <>
            {refreshing ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Refreshing
              </div>
            ) : null}
            <Button variant="outline" onClick={() => { void refreshAll(); }} disabled={refreshing}>
              Refresh
            </Button>
            <Button variant="outline" onClick={exportRecords} disabled={exporting}>
              {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Export XLSX
            </Button>
            <Button className="bg-brand-yellow text-slate-950 hover:bg-brand-yellow/90" onClick={() => setCreatingRecord(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Record
            </Button>
          </>
        }
      />

      <TrainingDevelopmentBanner />

      {summary ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="Active Records" value={summary.activeRecords} description={`${summary.totalRecords} total imported/manual records`} />
          <SummaryCard label="Expired" value={summary.expiredRecords} description="Active records with expiry before today" />
          <SummaryCard label="Expiring Soon" value={summary.expiringSoonRecords} description="Active records expiring in the next 90 days" />
          <SummaryCard label="Needs Review" value={summary.manualReviewRecords + summary.unlinkedPeople} description="Manual qualification reviews plus unlinked people" />
        </div>
      ) : null}

      {activeSliceErrors.length > 0 ? (
        <div role="alert" className="flex flex-col gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
          {activeSliceErrors.map((slice) => (
            <p key={slice}>{sliceStatus[slice].error}</p>
          ))}
          <div>
            <Button
              type="button"
              variant="outline"
              onClick={() => { void refreshSlices(activeSliceErrors, { background: false, showRefreshing: true }); }}
            >
              Retry
            </Button>
          </div>
        </div>
      ) : null}

      <Tabs value={activeTab} onValueChange={(value) => setTab(value as TrainingTab)}>
        <TabsList className="h-auto flex-wrap p-1.5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="records">Records</TabsTrigger>
          <TabsTrigger value="people">People</TabsTrigger>
          <TabsTrigger value="qualifications">Qualifications</TabsTrigger>
          <TabsTrigger value="notes">Workbook Notes</TabsTrigger>
        </TabsList>

        {activeTabLoading ? <PageLoader message="Loading training..." /> : <>
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Priority Training Records</CardTitle>
                <CardDescription>Expired, expiring, missing expiry, and CPCS action-status records.</CardDescription>
              </CardHeader>
              <CardContent>
                {priorityTrainingRecords.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No training records found.</p>
                ) : (
                  <div className="space-y-3">
                    {priorityTrainingRecords.map((record) => (
                      <div key={record.id} className="flex flex-col gap-2 rounded-lg border border-border p-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="font-medium">{record.employee_name_raw || 'Unknown person'}</div>
                          <div className="text-sm text-muted-foreground">{record.qualification_canonical_proposed}</div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="outline" className={expiryBadgeClass(getExpiryStatus(record))}>
                            {getExpiryStatus(record) === 'none' ? 'No expiry' : formatDate(record.expiry_date)}
                          </Badge>
                          {record.cpcs_statuses.map((status) => (
                            <Badge key={status} variant="outline">{formatStatusLabel(status)}</Badge>
                          ))}
                        </div>
                      </div>
                      ))}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Import Health</CardTitle>
                <CardDescription>Useful cleanup buckets before Phase 2 automation.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between"><span>No expiry</span><strong>{summary?.noExpiryRecords || 0}</strong></div>
                <div className="flex justify-between"><span>Needs NVQ</span><strong>{summary?.needsNvqRecords || 0}</strong></div>
                <div className="flex justify-between"><span>Awaiting card</span><strong>{summary?.awaitingCardRecords || 0}</strong></div>
                <div className="flex justify-between"><span>Training booked</span><strong>{summary?.trainingBookedRecords || 0}</strong></div>
                <div className="flex justify-between"><span>Unlinked people</span><strong>{summary?.unlinkedPeople || 0}</strong></div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="records" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Training Records</CardTitle>
              <CardDescription>Search, filter, edit, archive, and export imported records.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col gap-3 md:flex-row">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-9" placeholder="Search employee, qualification, card, sheet, comments..." value={recordSearch} onChange={(event) => setRecordSearch(event.target.value)} />
                </div>
                <Select value={recordFilter} onValueChange={(value) => setRecordFilter(value as RecordFilter)}>
                  <SelectTrigger className="md:w-56"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RECORD_FILTERS.map((filter) => (
                      <SelectItem key={filter.value} value={filter.value}>{filter.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Qualification</TableHead>
                      <TableHead>Expiry</TableHead>
                      <TableHead>CPCS / Status</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recordPagination.visibleItems.map((record) => {
                      const expiryStatus = getExpiryStatus(record);
                      return (
                        <TableRow key={record.id}>
                          <TableCell>
                            <div className="font-medium">{record.employee_name_raw || 'Unknown'}</div>
                            <div className="text-xs text-muted-foreground">{record.person?.profile_match_status ? formatStatusLabel(record.person.profile_match_status) : 'No person link'}</div>
                          </TableCell>
                          <TableCell className="max-w-md">
                            <div className="font-medium">{record.qualification_canonical_proposed}</div>
                            <div className="truncate text-xs text-muted-foreground">{record.qualification_raw}</div>
                            {record.qualification_validation_status === 'needs_manual_review' ? (
                              <Badge variant="outline" className="mt-1 border-amber-500/30 bg-amber-500/10 text-amber-300">Needs review</Badge>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={expiryBadgeClass(expiryStatus)}>
                              {expiryStatus === 'none' ? 'No expiry' : formatDate(record.expiry_date)}
                            </Badge>
                            {record.expiry_raw && record.expiry_raw !== record.expiry_date ? (
                              <div className="mt-1 text-xs text-muted-foreground">Raw: {record.expiry_raw}</div>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {record.record_status === 'archived' ? <Badge variant="outline">Archived</Badge> : null}
                              {record.cpcs_statuses.length > 0 ? record.cpcs_statuses.map((status) => (
                                <Badge key={status} variant="outline">{formatStatusLabel(status)}</Badge>
                              )) : <span className="text-xs text-muted-foreground">-</span>}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div>{record.source_sheet}</div>
                            <div className="text-xs text-muted-foreground">Row {record.source_row}</div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button variant="outline" size="sm" onClick={() => setEditingRecord(record)}>
                                <Edit className="mr-1.5 h-3.5 w-3.5" />
                                Edit
                              </Button>
                              {record.record_status === 'active' ? (
                                <Button variant="outline" size="sm" onClick={() => archiveRecord(record)} disabled={archivingRecordId === record.id}>
                                  {archivingRecordId === record.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Archive className="mr-1.5 h-3.5 w-3.5" />}
                                  Archive
                                </Button>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <LoadMorePagination visibleCount={recordPagination.visibleItems.length} totalCount={filteredRecords.length} itemLabel="records" onShowMore={recordPagination.showMore} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="people" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Training People</CardTitle>
              <CardDescription>Imported people with best-effort profile matches for future module links.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input placeholder="Search people..." value={peopleSearch} onChange={(event) => setPeopleSearch(event.target.value)} />
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Profile</TableHead>
                      <TableHead>Source Sheets</TableHead>
                      <TableHead>Records</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {peoplePagination.visibleItems.map((person) => (
                      <TableRow key={person.id}>
                        <TableCell>
                          <div className="font-medium">{person.employee_name_raw}</div>
                          <div className="text-xs text-muted-foreground">{person.employee_key}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{formatStatusLabel(person.profile_match_status)}</Badge>
                          <div className="mt-1 text-xs text-muted-foreground">{person.profile?.full_name || person.profile_match_notes || 'No linked profile'}</div>
                        </TableCell>
                        <TableCell className="max-w-sm truncate">{person.source_sheets.join(', ')}</TableCell>
                        <TableCell>{person.record_count}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="outline" size="sm" onClick={() => setEditingPerson(person)}>
                            <Edit className="mr-1.5 h-3.5 w-3.5" />
                            Edit
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <LoadMorePagination visibleCount={peoplePagination.visibleItems.length} totalCount={filteredPeople.length} itemLabel="people" onShowMore={peoplePagination.showMore} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="qualifications" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Qualification Catalogue</CardTitle>
              <CardDescription>Raw qualification strings with proposed canonical names awaiting client review.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col gap-3 md:flex-row">
                <Input placeholder="Search qualifications..." value={qualificationSearch} onChange={(event) => setQualificationSearch(event.target.value)} />
                <Select value={qualificationStatus} onValueChange={setQualificationStatus}>
                  <SelectTrigger className="md:w-72"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {TRAINING_VALIDATION_STATUS_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Raw</TableHead>
                      <TableHead>Canonical Proposed</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Records</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {qualificationPagination.visibleItems.map((qualification) => (
                      <TableRow key={qualification.id}>
                        <TableCell className="max-w-lg truncate">{qualification.qualification_raw}</TableCell>
                        <TableCell className="max-w-lg truncate">{qualification.canonical_name}</TableCell>
                        <TableCell><Badge variant="outline">{formatStatusLabel(qualification.validation_status)}</Badge></TableCell>
                        <TableCell>{qualification.record_count}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="outline" size="sm" onClick={() => setEditingQualification(qualification)}>
                            <Edit className="mr-1.5 h-3.5 w-3.5" />
                            Edit
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <LoadMorePagination visibleCount={qualificationPagination.visibleItems.length} totalCount={filteredQualifications.length} itemLabel="qualifications" onShowMore={qualificationPagination.showMore} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notes" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Workbook Notes</CardTitle>
              <CardDescription>Preserved free text that was intentionally not mixed into training records.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input placeholder="Search notes..." value={notesSearch} onChange={(event) => setNotesSearch(event.target.value)} />
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Sheet / Cell</TableHead>
                      <TableHead>Value</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {notesPagination.visibleItems.map((note) => (
                      <TableRow key={note.id}>
                        <TableCell><Badge variant="outline">{formatStatusLabel(note.note_type)}</Badge></TableCell>
                        <TableCell>
                          <div>{note.source_sheet}</div>
                          <div className="text-xs text-muted-foreground">{note.cell_address}</div>
                        </TableCell>
                        <TableCell className="max-w-xl">{note.note_value}</TableCell>
                        <TableCell className="max-w-xl text-sm text-muted-foreground">{note.reason || '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <LoadMorePagination visibleCount={notesPagination.visibleItems.length} totalCount={filteredNotes.length} itemLabel="notes" onShowMore={notesPagination.showMore} />
            </CardContent>
          </Card>
        </TabsContent>
        </>}
      </Tabs>

      <TrainingRecordDialog
        open={Boolean(editingRecord) || creatingRecord}
        record={editingRecord}
        onClose={() => { setEditingRecord(null); setCreatingRecord(false); }}
        onSubmit={saveRecord}
      />
      <TrainingPersonDialog
        open={Boolean(editingPerson)}
        person={editingPerson}
        onClose={() => setEditingPerson(null)}
        onSubmit={savePerson}
      />
      <TrainingQualificationDialog
        open={Boolean(editingQualification)}
        qualification={editingQualification}
        onClose={() => setEditingQualification(null)}
        onSubmit={saveQualification}
      />
    </AppPageShell>
  );
}

function TrainingPageContent() {
  const { user, profile, isViewingAs, effectiveRole } = useAuth();
  const { hasPermission, loading: permissionLoading } = usePermissionCheck('training', false);
  const contextKey = buildTrainingAccessKey({
    userId: user?.id ?? null,
    profileRoleName: profile?.role?.name ?? '',
    profileTeamId: profile?.team?.id ?? profile?.team_id ?? '',
    profileTeamName: profile?.team?.name ?? '',
    isViewingAs: Boolean(isViewingAs),
    effectiveRoleName: effectiveRole?.name ?? '',
    effectiveTeamId: effectiveRole?.team_id ?? '',
    effectiveTeamName: effectiveRole?.team_name ?? '',
    hasPermission,
    permissionLoading,
  });

  return (
    <TrainingContent
      key={contextKey || 'no-training-context'}
      contextKey={contextKey}
      hasPermission={hasPermission}
      permissionLoading={permissionLoading}
    />
  );
}

export default function TrainingPage() {
  return (
    <Suspense fallback={<PageLoader message="Loading training..." />}>
      <TrainingPageContent />
    </Suspense>
  );
}
