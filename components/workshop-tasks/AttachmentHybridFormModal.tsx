'use client';

import { useEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import Image from 'next/image';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { TabletActionBar } from '@/components/ui/tablet-action-bar';
import { SignaturePad } from '@/components/forms/SignaturePad';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import { useWorkshopDraftPersistence } from '@/lib/hooks/useWorkshopDraftPersistence';
import { Download, Loader2, X } from 'lucide-react';
import type {
  AttachmentSchemaField,
  AttachmentSchemaResponse,
  AttachmentSchemaSection,
  AttachmentSchemaSnapshot,
} from '@/types/workshop-attachments-v2';
import { getErrorStatus } from '@/lib/utils/http-error';
import { toast } from 'sonner';

interface AttachmentHybridFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateName: string;
  snapshot: AttachmentSchemaSnapshot;
  existingResponses: AttachmentSchemaResponse[];
  readOnly?: boolean;
  isCompleted?: boolean;
  attachmentId?: string;
  initialActiveSectionKey?: string;
  initialScrollTop?: number;
  onActiveSectionChange?: (sectionKey: string) => void;
  onScrollPositionChange?: (scrollTop: number) => void;
  onSave: (responses: AttachmentSchemaResponse[], markComplete: boolean) => Promise<void>;
  canUndoComplete?: boolean;
  undoCompleteLabel?: string | null;
  onUndoComplete?: () => Promise<void>;
  undoingComplete?: boolean;
}

interface LocalResponseValue {
  response_value: string | null;
  response_json: Record<string, unknown> | null;
  field_id: string | null;
}

interface InitialResponseState {
  responses: Record<string, LocalResponseValue>;
  signatureNames: Record<string, string>;
  fingerprint: string;
}

interface SaveAttachmentOptions {
  markComplete: boolean;
  closeOnSuccess?: boolean;
  showSuccessToast?: boolean;
}

const MARKING_CODE_OPTIONS = [
  { value: 'serviceable', label: 'Pass', tone: 'success' as const },
  { value: 'attention', label: 'Fail', tone: 'danger' as const },
  { value: 'not_applicable', label: 'N/A', tone: 'neutral' as const },
];

const YES_NO_OPTIONS = [
  { value: 'yes', label: 'Yes', tone: 'success' as const },
  { value: 'no', label: 'No', tone: 'danger' as const },
  { value: 'na', label: 'N/A', tone: 'neutral' as const },
];

function getChoiceButtonClasses(
  tone: 'success' | 'danger' | 'neutral',
  selected: boolean,
  tabletModeEnabled: boolean,
): string {
  const baseClasses = [
    'rounded-lg border font-semibold transition-all duration-150',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-workshop/60',
    tabletModeEnabled ? 'min-h-12 text-base px-4 py-3' : 'min-h-10 text-sm px-3 py-2',
  ].join(' ');

  if (tone === 'success') {
    return [
      baseClasses,
      selected
        ? 'border-green-600 bg-green-600 text-white shadow-sm'
        : 'border-green-500/40 bg-green-500/10 text-green-700 hover:bg-green-500/20 dark:text-green-300',
    ].join(' ');
  }

  if (tone === 'danger') {
    return [
      baseClasses,
      selected
        ? 'border-red-600 bg-red-600 text-white shadow-sm'
        : 'border-red-500/40 bg-red-500/10 text-red-700 hover:bg-red-500/20 dark:text-red-300',
    ].join(' ');
  }

  return [
    baseClasses,
    selected
      ? 'border-slate-500 bg-slate-600 text-white shadow-sm'
      : 'border-slate-500/40 bg-slate-500/10 text-slate-700 hover:bg-slate-500/20 dark:text-slate-300',
  ].join(' ');
}

function toResponseKey(sectionKey: string, fieldKey: string): string {
  return `${sectionKey}::${fieldKey}`;
}

function getInitialResponseState(existingResponses: AttachmentSchemaResponse[]): InitialResponseState {
  const responses: Record<string, LocalResponseValue> = {};
  const signatureNames: Record<string, string> = {};

  existingResponses.forEach((response) => {
    const key = toResponseKey(response.section_key, response.field_key);
    responses[key] = {
      response_value: response.response_value ?? null,
      response_json: response.response_json ?? null,
      field_id: response.field_id ?? null,
    };

    const signedByName = normalizeValue(response.response_json?.signed_by_name);
    if (signedByName.length > 0) {
      signatureNames[key] = signedByName;
    }
  });

  return {
    responses,
    signatureNames,
    fingerprint: getResponsesFingerprint(responses),
  };
}

function normalizeValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function toInputValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

const SUPPRESSED_FIELD_HELP_TEXTS = new Set([
  'use attention codes consistently; add notes for issues or skipped checks.',
  'use attention codes consistently; add notes for issues or skipped checks',
]);

function shouldRenderFieldHelpText(helpText: string): boolean {
  const normalized = helpText.toLowerCase().replace(/\s+/g, ' ').trim();
  return normalized.length > 0 && !SUPPRESSED_FIELD_HELP_TEXTS.has(normalized);
}

function isExpectedAttachmentPersistenceError(error: unknown): boolean {
  const status = getErrorStatus(error);
  return status === 404 || status === 409;
}

function getAttachmentPersistenceErrorMessage(error: unknown): string {
  if (getErrorStatus(error) === 404) {
    return 'This attachment is no longer available. Refreshing the task attachments.';
  }
  if (getErrorStatus(error) === 409) {
    return error instanceof Error ? error.message : 'This attachment can no longer be edited.';
  }
  return 'Failed to save attachment';
}

function getValidationRequiredNoteValues(field: AttachmentSchemaField): string[] {
  if (!field.validation_json || !Array.isArray(field.validation_json.require_note_for)) return [];
  return (field.validation_json.require_note_for as unknown[])
    .map((entry) => normalizeValue(entry))
    .filter(Boolean);
}

function isSignatureComplete(responseJson: Record<string, unknown> | null): boolean {
  if (!responseJson) return false;
  const dataUrl = normalizeValue(responseJson.data_url);
  const signedByName = normalizeValue(responseJson.signed_by_name);
  const signedAt = normalizeValue(responseJson.signed_at);
  return dataUrl.length > 0 && signedByName.length > 0 && signedAt.length > 0;
}

function normalizeResponseJsonForFingerprint(responseJson: Record<string, unknown> | null): Record<string, string> | null {
  if (!responseJson) return null;
  const normalizedEntries = Object.entries(responseJson)
    .map(([key, value]) => [key, normalizeValue(value)] as const)
    .filter(([, value]) => value.length > 0)
    .sort(([a], [b]) => a.localeCompare(b));

  if (normalizedEntries.length === 0) return null;
  return Object.fromEntries(normalizedEntries);
}

function hasMeaningfulResponse(response: LocalResponseValue | undefined): boolean {
  if (!response) return false;
  const value = normalizeValue(response.response_value);
  if (value.length > 0) return true;
  return normalizeResponseJsonForFingerprint(response.response_json) !== null;
}

function getResponsesFingerprint(values: Record<string, LocalResponseValue>): string {
  const normalized = Object.entries(values)
    .filter(([, response]) => hasMeaningfulResponse(response))
    .map(([key, response]) => {
      const responseValue = normalizeValue(response.response_value);
      const responseJson = normalizeResponseJsonForFingerprint(response.response_json);
      return [
        key,
        responseValue,
        responseJson ? JSON.stringify(responseJson) : '',
      ] as const;
    })
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));

  return JSON.stringify(normalized);
}

function isFieldAnswered(field: AttachmentSchemaField, response: LocalResponseValue | undefined): boolean {
  if (!response) return false;
  if (field.field_type === 'signature') return isSignatureComplete(response.response_json);
  return normalizeValue(response.response_value).length > 0;
}

function requiresAttentionNote(field: AttachmentSchemaField, response: LocalResponseValue | undefined): boolean {
  if (!response || field.field_type !== 'marking_code') return false;
  const responseValue = normalizeValue(response.response_value);
  if (!responseValue) return false;
  const valuesThatNeedNotes = getValidationRequiredNoteValues(field);
  if (!valuesThatNeedNotes.includes(responseValue)) return false;
  const note = normalizeValue(response.response_json?.note);
  return note.length === 0;
}

function findFirstInvalidRequired(
  sections: AttachmentSchemaSection[],
  responses: Record<string, LocalResponseValue>,
): { sectionKey: string; fieldKey: string; label: string } | null {
  for (const section of sections) {
    for (const field of section.fields) {
      if (!field.is_required) continue;
      const response = responses[toResponseKey(section.section_key, field.field_key)];
      if (!isFieldAnswered(field, response)) {
        return {
          sectionKey: section.section_key,
          fieldKey: field.field_key,
          label: field.label,
        };
      }
      if (requiresAttentionNote(field, response)) {
        return {
          sectionKey: section.section_key,
          fieldKey: field.field_key,
          label: `${field.label} note`,
        };
      }
    }
  }
  return null;
}

export function AttachmentHybridFormModal({
  open,
  onOpenChange,
  templateName,
  snapshot,
  existingResponses,
  readOnly = false,
  isCompleted = false,
  attachmentId,
  initialActiveSectionKey,
  initialScrollTop = 0,
  onActiveSectionChange,
  onScrollPositionChange,
  onSave,
  canUndoComplete = false,
  undoCompleteLabel = null,
  onUndoComplete,
  undoingComplete = false,
}: AttachmentHybridFormModalProps) {
  const { tabletModeEnabled } = useTabletMode();
  const sections = useMemo(
    () => (snapshot.snapshot_json.sections || []).slice().sort((a, b) => a.sort_order - b.sort_order),
    [snapshot],
  );
  const [activeSectionKey, setActiveSectionKey] = useState<string>('');
  const [guidedMode, setGuidedMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [responses, setResponses] = useState<Record<string, LocalResponseValue>>({});
  const [activeSignatureKey, setActiveSignatureKey] = useState<string | null>(null);
  const [signatureNames, setSignatureNames] = useState<Record<string, string>>({});
  const [initialResponsesFingerprint, setInitialResponsesFingerprint] = useState<string | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const initializedSessionKeyRef = useRef<string | null>(null);
  const restoredScrollSessionKeyRef = useRef<string | null>(null);
  const mainScrollAreaRef = useRef<HTMLDivElement | null>(null);
  const formSessionKey = `${attachmentId || 'new-attachment'}:${snapshot.id}:${snapshot.template_version_id}`;

  useEffect(() => {
    if (!open) {
      initializedSessionKeyRef.current = null;
      restoredScrollSessionKeyRef.current = null;
      return;
    }
    if (initializedSessionKeyRef.current === formSessionKey) return;
    initializedSessionKeyRef.current = formSessionKey;

    const initialSectionKey = initialActiveSectionKey
      && sections.some((section) => section.section_key === initialActiveSectionKey)
      ? initialActiveSectionKey
      : sections[0]?.section_key || '';
    setActiveSectionKey(initialSectionKey);
    setActiveSignatureKey(null);

    const initialResponseState = getInitialResponseState(existingResponses);
    setResponses(initialResponseState.responses);
    setSignatureNames(initialResponseState.signatureNames);
    setInitialResponsesFingerprint(initialResponseState.fingerprint);
  }, [existingResponses, formSessionKey, initialActiveSectionKey, open, sections]);

  useEffect(() => {
    if (!open || !activeSectionKey) return;
    onActiveSectionChange?.(activeSectionKey);
  }, [activeSectionKey, onActiveSectionChange, open]);

  useEffect(() => {
    if (!open || !activeSectionKey || restoredScrollSessionKeyRef.current === formSessionKey) return;
    const scrollArea = mainScrollAreaRef.current;
    if (!scrollArea) return;

    restoredScrollSessionKeyRef.current = formSessionKey;
    scrollArea.scrollTop = initialScrollTop;
  }, [activeSectionKey, formSessionKey, initialScrollTop, open]);

  const activeSection = sections.find((section) => section.section_key === activeSectionKey) || sections[0];
  const totalFields = sections.reduce((sum, section) => sum + section.fields.length, 0);
  const totalRequired = sections.reduce((sum, section) => sum + section.fields.filter((field) => field.is_required).length, 0);

  const completedTotal = sections.reduce((sum, section) => (
    sum + section.fields.filter((field) => {
      const response = responses[toResponseKey(section.section_key, field.field_key)];
      return isFieldAnswered(field, response);
    }).length
  ), 0);

  const completedRequired = sections.reduce((sum, section) => (
    sum + section.fields.filter((field) => {
      if (!field.is_required) return false;
      const response = responses[toResponseKey(section.section_key, field.field_key)];
      return isFieldAnswered(field, response) && !requiresAttentionNote(field, response);
    }).length
  ), 0);

  const attentionItemsRemaining = sections.reduce((sum, section) => (
    sum + section.fields.filter((field) => {
      const response = responses[toResponseKey(section.section_key, field.field_key)];
      return requiresAttentionNote(field, response);
    }).length
  ), 0);

  const isDirty = useMemo(
    () => initialResponsesFingerprint !== null
      && getResponsesFingerprint(responses) !== initialResponsesFingerprint,
    [initialResponsesFingerprint, responses],
  );
  const { clearDraft } = useWorkshopDraftPersistence({
    enabled: open && !readOnly && !isCompleted && Boolean(attachmentId),
    draftId: `workshop-attachment:${attachmentId || 'none'}`,
    kind: 'workshop-attachment',
    value: {
      responses,
      signatureNames,
      activeSectionKey,
    },
    isDirty,
    onRestore: (draft) => {
      setResponses(draft.responses || {});
      setSignatureNames(draft.signatureNames || {});
      setActiveSectionKey(draft.activeSectionKey || sections[0]?.section_key || '');
    },
    onServerAutosave: async (draft) => {
      await onSave(buildResponsesPayload(draft.responses || {}), false);
      setInitialResponsesFingerprint(getResponsesFingerprint(draft.responses || {}));
    },
    clearLocalDraftAfterServerAutosave: true,
    autosaveDelayMs: 5_000,
  });

  function setFieldResponse(
    sectionKey: string,
    field: AttachmentSchemaField,
    nextValue: string | null,
    nextJson?: Record<string, unknown> | null,
  ) {
    const key = toResponseKey(sectionKey, field.field_key);
    setResponses((prev) => ({
      ...prev,
      [key]: {
        response_value: nextValue,
        response_json: nextJson ?? prev[key]?.response_json ?? null,
        field_id: field.id || prev[key]?.field_id || null,
      },
    }));
  }

  function setFieldResponseJson(sectionKey: string, field: AttachmentSchemaField, updates: Record<string, unknown>) {
    const key = toResponseKey(sectionKey, field.field_key);
    setResponses((prev) => ({
      ...prev,
      [key]: {
        response_value: prev[key]?.response_value ?? null,
        response_json: {
          ...prev[key]?.response_json,
          ...updates,
        },
        field_id: field.id || prev[key]?.field_id || null,
      },
    }));
  }

  function sectionStats(section: AttachmentSchemaSection) {
    const requiredCount = section.fields.filter((field) => field.is_required).length;
    const requiredComplete = section.fields.filter((field) => {
      if (!field.is_required) return false;
      const response = responses[toResponseKey(section.section_key, field.field_key)];
      return isFieldAnswered(field, response) && !requiresAttentionNote(field, response);
    }).length;
    return { requiredCount, requiredComplete };
  }

  function buildResponsesPayload(nextResponses: Record<string, LocalResponseValue>): AttachmentSchemaResponse[] {
    const payload: AttachmentSchemaResponse[] = [];
    sections.forEach((section) => {
      section.fields.forEach((field) => {
        const key = toResponseKey(section.section_key, field.field_key);
        const response = nextResponses[key];
        payload.push({
          field_id: response?.field_id || field.id || null,
          section_key: section.section_key,
          field_key: field.field_key,
          response_value: response?.response_value ?? null,
          response_json: response?.response_json ?? null,
        });
      });
    });
    return payload;
  }

  async function saveAttachment({
    markComplete,
    closeOnSuccess = false,
    showSuccessToast = true,
  }: SaveAttachmentOptions): Promise<boolean> {
    if (saving || readOnly) return false;
    const invalidField = markComplete ? findFirstInvalidRequired(sections, responses) : null;
    if (invalidField) {
      setActiveSectionKey(invalidField.sectionKey);
      toast.error(`Complete required field: ${invalidField.label}`);
      return false;
    }

    const payload = buildResponsesPayload(responses);

    setSaving(true);
    try {
      await onSave(payload, markComplete);
      setInitialResponsesFingerprint(getResponsesFingerprint(responses));
      void clearDraft();
      if (showSuccessToast) {
        toast.success(markComplete ? 'Attachment completed' : 'Draft saved');
      }
      setSaving(false);
      if (markComplete || closeOnSuccess) onOpenChange(false);
      return true;
    } catch (error) {
      if (isExpectedAttachmentPersistenceError(error)) {
        console.warn('Attachment save was rejected:', error);
      } else {
        console.error('Error saving schema attachment responses:', error);
      }
      toast.error(getAttachmentPersistenceErrorMessage(error));
      setSaving(false);
      return false;
    }
  }

  async function handleSave(markComplete: boolean) {
    await saveAttachment({ markComplete });
  }

  function navigateSection(direction: 'next' | 'previous') {
    if (!activeSection) return;
    const currentIndex = sections.findIndex((section) => section.section_key === activeSection.section_key);
    if (currentIndex < 0) return;
    const nextIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
    if (nextIndex < 0 || nextIndex >= sections.length) return;
    setActiveSectionKey(sections[nextIndex].section_key);
  }

  function handleMainScroll(event: UIEvent<HTMLDivElement>) {
    onScrollPositionChange?.(event.currentTarget.scrollTop);
  }

  async function handleDownloadPdf() {
    if (!attachmentId || downloadingPdf) return;

    setDownloadingPdf(true);
    try {
      const response = await fetch(`/api/workshop-tasks/attachments/${attachmentId}/pdf`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to generate PDF');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${templateName.replace(/[^a-z0-9]/gi, '_')}_attachment.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('PDF downloaded');
    } catch (error) {
      console.error('Error downloading attachment PDF:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to download PDF');
    } finally {
      setDownloadingPdf(false);
    }
  }

  function renderField(section: AttachmentSchemaSection, field: AttachmentSchemaField) {
    const key = toResponseKey(section.section_key, field.field_key);
    const response = responses[key];
    const responseValue = response?.response_value ?? '';
    const responseJson = response?.response_json ?? null;
    const noteRequired = requiresAttentionNote(field, response);
    const noteValue = toInputValue(responseJson?.note);
    const isFieldRequired = field.is_required;
    const fieldHelpText = normalizeValue(field.help_text);

    function renderHelpText() {
      if (!shouldRenderFieldHelpText(fieldHelpText)) return null;
      return <p className="text-xs text-muted-foreground">{fieldHelpText}</p>;
    }

    if (field.field_type === 'marking_code') {
      return (
        <div className="space-y-2">
          <Label htmlFor={key}>
            {field.label}
            {isFieldRequired && <span className="text-red-500 ml-1">*</span>}
          </Label>
          {renderHelpText()}
          <div className="mt-1 grid grid-cols-2 md:grid-cols-3 gap-2">
            {MARKING_CODE_OPTIONS.map((option) => {
              const isSelected = responseValue === option.value;
              return (
                <Button
                  key={option.value}
                  type="button"
                  variant="outline"
                  onClick={() => setFieldResponse(section.section_key, field, option.value)}
                  disabled={readOnly}
                  aria-pressed={isSelected}
                  className={getChoiceButtonClasses(option.tone, isSelected, tabletModeEnabled)}
                >
                  {option.label}
                </Button>
              );
            })}
          </div>
          {(noteRequired || noteValue.length > 0) && (
            <div className="space-y-2">
              <Label htmlFor={`${key}__note`}>
                Notes
                {noteRequired && <span className="text-red-500 ml-1">*</span>}
              </Label>
              <Textarea
                id={`${key}__note`}
                value={noteValue}
                onChange={(event) => setFieldResponseJson(section.section_key, field, { note: event.target.value })}
                placeholder="Add details for this item"
                disabled={readOnly}
                rows={3}
              />
            </div>
          )}
        </div>
      );
    }

    if (field.field_type === 'yes_no') {
      return (
        <div className="space-y-2">
          <Label htmlFor={key}>
            {field.label}
            {isFieldRequired && <span className="text-red-500 ml-1">*</span>}
          </Label>
          {renderHelpText()}
          <div className="mt-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
            {YES_NO_OPTIONS.map((option) => {
              const isSelected = responseValue === option.value;
              return (
                <Button
                  key={option.value}
                  type="button"
                  variant="outline"
                  onClick={() => setFieldResponse(section.section_key, field, option.value)}
                  disabled={readOnly}
                  aria-pressed={isSelected}
                  className={getChoiceButtonClasses(option.tone, isSelected, tabletModeEnabled)}
                >
                  {option.label}
                </Button>
              );
            })}
          </div>
        </div>
      );
    }

    if (field.field_type === 'signature') {
      const signatureDataUrl = normalizeValue(responseJson?.data_url);
      const signatureName = signatureNames[key] || normalizeValue(responseJson?.signed_by_name);
      const isPadOpen = activeSignatureKey === key;
      return (
        <div className="space-y-3">
          <Label>
            {field.label}
            {isFieldRequired && <span className="text-red-500 ml-1">*</span>}
          </Label>
          {renderHelpText()}
          <Input
            value={signatureName}
            onChange={(event) => {
              const value = event.target.value;
              setSignatureNames((prev) => ({ ...prev, [key]: value }));
              setFieldResponseJson(section.section_key, field, { signed_by_name: value });
            }}
            placeholder="Signer name"
            disabled={readOnly}
            className={tabletModeEnabled ? 'min-h-11 text-base' : undefined}
          />
          {signatureDataUrl && (
            <div className="rounded-md border border-border p-2 bg-white">
              <Image
                src={signatureDataUrl}
                alt="Signature preview"
                width={420}
                height={140}
                unoptimized
                className="max-h-24 w-full object-contain"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Saved by {normalizeValue(responseJson?.signed_by_name) || 'Unknown'} at {normalizeValue(responseJson?.signed_at) || 'Unknown time'}
              </p>
            </div>
          )}
          {!readOnly && (
            <>
              {!isPadOpen && (
                <Button variant="outline" type="button" onClick={() => setActiveSignatureKey(key)}>
                  {signatureDataUrl ? 'Update Signature' : 'Capture Signature'}
                </Button>
              )}
              {isPadOpen && (
                <SignaturePad
                  onCancel={() => setActiveSignatureKey(null)}
                  onSave={(dataUrl) => {
                    const signedByName = normalizeValue(signatureNames[key]);
                    if (!signedByName) {
                      toast.error('Signer name required before saving signature');
                      return;
                    }
                    setFieldResponse(section.section_key, field, signedByName, {
                      data_url: dataUrl,
                      signed_by_name: signedByName,
                      signed_at: new Date().toISOString(),
                    });
                    setActiveSignatureKey(null);
                  }}
                  initialValue={signatureDataUrl || null}
                  variant="default"
                />
              )}
            </>
          )}
        </div>
      );
    }

    if (field.field_type === 'long_text') {
      return (
        <div className="space-y-2">
          <Label htmlFor={key}>
            {field.label}
            {isFieldRequired && <span className="text-red-500 ml-1">*</span>}
          </Label>
          {renderHelpText()}
          <Textarea
            id={key}
            value={responseValue}
            onChange={(event) => setFieldResponse(section.section_key, field, event.target.value)}
            disabled={readOnly}
            rows={3}
          />
        </div>
      );
    }

    if (field.field_type === 'number') {
      return (
        <div className="space-y-2">
          <Label htmlFor={key}>
            {field.label}
            {isFieldRequired && <span className="text-red-500 ml-1">*</span>}
          </Label>
          {renderHelpText()}
          <Input
            id={key}
            type="number"
            value={responseValue}
            onChange={(event) => setFieldResponse(section.section_key, field, event.target.value)}
            disabled={readOnly}
            className={tabletModeEnabled ? 'min-h-11 text-base' : undefined}
          />
        </div>
      );
    }

    if (field.field_type === 'date') {
      return (
        <div className="space-y-2">
          <Label htmlFor={key}>
            {field.label}
            {isFieldRequired && <span className="text-red-500 ml-1">*</span>}
          </Label>
          {renderHelpText()}
          <Input
            id={key}
            type="date"
            value={responseValue}
            onChange={(event) => setFieldResponse(section.section_key, field, event.target.value)}
            disabled={readOnly}
            className={tabletModeEnabled ? 'min-h-11 text-base' : undefined}
          />
        </div>
      );
    }

    return (
      <div className="space-y-2">
        <Label htmlFor={key}>
          {field.label}
          {isFieldRequired && <span className="text-red-500 ml-1">*</span>}
        </Label>
        {renderHelpText()}
        <Input
          id={key}
          value={responseValue}
          onChange={(event) => setFieldResponse(section.section_key, field, event.target.value)}
          disabled={readOnly}
          className={tabletModeEnabled ? 'min-h-11 text-base' : undefined}
        />
      </div>
    );
  }

  function handleDialogOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      onOpenChange(true);
      return;
    }

    if (saving || undoingComplete) return;

    if (!readOnly && !isCompleted && isDirty) {
      void saveAttachment({
        markComplete: false,
        closeOnSuccess: true,
        showSuccessToast: false,
      });
      return;
    }

    onOpenChange(false);
  }

  function discardDraftAndClose() {
    void clearDraft();
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleDialogOpenChange}
    >
      <DialogContent className="max-w-6xl max-h-[92vh] p-0 overflow-hidden border border-workshop/30 shadow-2xl bg-gradient-to-b from-workshop/5 via-background to-background [&>button]:hidden">
        <div className="px-4 py-3 border-b border-border/80 bg-gradient-to-r from-workshop/10 via-background to-background">
          <div className="flex items-start justify-between gap-3">
            <DialogHeader>
              <DialogTitle>{templateName}</DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-2">
                <span>{completedTotal} / {totalFields} fields completed</span>
                <span className="text-muted-foreground">•</span>
                <span className={completedRequired === totalRequired ? 'text-green-600' : 'text-amber-600'}>
                  {completedRequired}/{totalRequired} required
                </span>
                <span className="text-muted-foreground">•</span>
                <span className={attentionItemsRemaining === 0 ? 'text-green-600' : 'text-amber-600'}>
                  {attentionItemsRemaining} attention notes pending
                </span>
              </DialogDescription>
            </DialogHeader>
            <div className="mt-1 flex items-center gap-2 shrink-0">
              {attachmentId && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => { void handleDownloadPdf(); }}
                  disabled={downloadingPdf}
                  className="border-workshop/30 text-workshop hover:bg-workshop/10"
                >
                  {downloadingPdf ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  {downloadingPdf ? 'Generating...' : 'Download PDF'}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => handleDialogOpenChange(false)}
                disabled={saving || undoingComplete}
                className="border-border/70 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </Button>
            </div>
          </div>
          {!readOnly && (
            <div className="mt-3 pt-3 border-t border-border/60 flex items-center gap-3">
              <Switch
                checked={guidedMode}
                onCheckedChange={setGuidedMode}
                id="guidedMode"
                disabled={saving}
              />
              <Label htmlFor="guidedMode" className="text-sm">
                Guided mode (focus unresolved required items)
              </Label>
            </div>
          )}
          {readOnly && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={isCompleted ? 'bg-green-600 text-white' : ''}>
                {isCompleted ? 'Completed' : 'Read Only'}
              </Badge>
              {canUndoComplete && (
                <p className="text-xs text-amber-600">
                  Undo available for {undoCompleteLabel || 'a short grace period'}.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] min-h-0 flex-1">
          <aside className="border-r border-border bg-workshop/5">
            <ScrollArea className="h-[62vh]">
              <div className="p-3 space-y-2">
                {sections.map((section) => {
                  const stats = sectionStats(section);
                  const isActive = activeSection?.section_key === section.section_key;
                  return (
                    <button
                      key={section.id}
                      onClick={() => setActiveSectionKey(section.section_key)}
                      className={`w-full rounded-lg border p-3 text-left transition ${
                        isActive
                          ? 'border-workshop bg-workshop/15 shadow-md ring-1 ring-workshop/25'
                          : 'border-border bg-background/90 shadow-sm hover:border-workshop/40 hover:shadow'
                      }`}
                    >
                      <p className="font-medium text-sm text-foreground">{section.title}</p>
                      {stats.requiredCount > 0 && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {stats.requiredComplete}/{stats.requiredCount} required
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </aside>

          <main className="min-h-0">
            <ScrollArea
              ref={mainScrollAreaRef}
              className="h-[62vh]"
              onScroll={handleMainScroll}
              data-testid="attachment-form-scroll-area"
            >
              {activeSection ? (
                <div className="p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-foreground">{activeSection.title}</h3>
                      {activeSection.description && (
                        <p className="text-sm text-muted-foreground mt-1">{activeSection.description}</p>
                      )}
                    </div>
                    {!readOnly && guidedMode && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          const invalidField = findFirstInvalidRequired(sections, responses);
                          if (!invalidField) {
                            toast.success('All required fields are completed.');
                            return;
                          }
                          setActiveSectionKey(invalidField.sectionKey);
                          toast.info(`Next required field: ${invalidField.label}`);
                        }}
                      >
                        Jump to Next Required
                      </Button>
                    )}
                  </div>

                  {activeSection.fields.map((field) => (
                    <div key={field.id} className="rounded-xl border border-border bg-background/95 shadow-sm p-4">
                      {renderField(activeSection, field)}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-5 text-sm text-muted-foreground">No schema sections available.</div>
              )}
            </ScrollArea>
          </main>
        </div>

        {!readOnly && (
          <>
            {tabletModeEnabled ? (
              <div className="px-5 pb-4">
                <TabletActionBar
                  statusText={`${completedRequired}/${totalRequired} required complete`}
                  tertiaryAction={{
                    label: isDirty ? 'Discard Changes' : 'Close',
                    onClick: discardDraftAndClose,
                    disabled: saving,
                    variant: 'outline',
                  }}
                  secondaryAction={{
                    label: saving ? 'Saving...' : 'Save Draft',
                    onClick: () => { void handleSave(false); },
                    disabled: saving,
                    variant: 'secondary',
                  }}
                  primaryAction={{
                    label: saving ? 'Saving...' : 'Complete Attachment',
                    onClick: () => { void handleSave(true); },
                    disabled: saving,
                    className: 'bg-green-600 hover:bg-green-700 text-white',
                  }}
                />
              </div>
            ) : (
              <DialogFooter className="px-5 py-4 border-t border-border">
                <Button variant="outline" onClick={discardDraftAndClose} disabled={saving}>
                  {isDirty ? 'Discard Changes' : 'Cancel'}
                </Button>
                <Button variant="outline" onClick={() => { void handleSave(false); }} disabled={saving}>
                  {saving ? 'Saving...' : 'Save Draft'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => navigateSection('previous')}
                  disabled={saving}
                  className="border-workshop/40 bg-workshop/10 text-workshop hover:bg-workshop/20"
                >
                  Previous Section
                </Button>
                <Button
                  variant="outline"
                  onClick={() => navigateSection('next')}
                  disabled={saving}
                  className="border-workshop/40 bg-workshop/10 text-workshop hover:bg-workshop/20"
                >
                  Next Section
                </Button>
                <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={() => { void handleSave(true); }} disabled={saving}>
                  {saving ? 'Saving...' : 'Complete Attachment'}
                </Button>
              </DialogFooter>
            )}
          </>
        )}

        {readOnly && (
          <DialogFooter className="px-5 py-4 border-t border-border">
            {canUndoComplete && onUndoComplete && (
              <Button
                variant="outline"
                onClick={() => { void onUndoComplete(); }}
                disabled={undoingComplete}
                className="border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950"
              >
                {undoingComplete ? 'Undoing...' : 'Undo Complete'}
              </Button>
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={undoingComplete}>
              Close
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
