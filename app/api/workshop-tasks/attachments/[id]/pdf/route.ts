import { NextRequest, NextResponse } from 'next/server';
import {
  getAdminFieldResponsesForAttachment,
  getAdminSchemaSnapshotForAttachment,
} from '@/lib/server/workshop-attachment-admin';
import { createClient } from '@/lib/supabase/server';
import { renderToStream } from '@react-pdf/renderer';
import { WorkshopAttachmentPDF, type V2PdfSectionData } from '@/lib/pdf/workshop-attachment-pdf';
import { loadTemplateLogoDataUrl } from '@/lib/pdf/template-logo';
import { normalizeSignatureDataUrl } from '@/lib/pdf/signature-image';
import { logServerError } from '@/lib/utils/server-error-logger';
import type { StatusHistoryEvent } from '@/lib/utils/workshopTaskStatusHistory';
import { inferAssetMeterUnit, normalizeAssetMeterUnit } from '@/lib/workshop-tasks/asset-meter';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Explicit types for Supabase query results (avoids generated-type `never` issue)
interface AttachmentRow {
  id: string;
  task_id: string;
  template_id: string;
  status: 'pending' | 'completed';
  completed_at: string | null;
  created_at: string;
  workshop_attachment_templates: {
    id: string;
    name: string;
    description: string | null;
  } | null;
}

interface TaskRow {
  id: string;
  title: string;
  status: string;
  created_at: string;
  actioned_at: string | null;
  status_history: unknown[] | null;
  workshop_comments: string | null;
  asset_meter_reading: number | null;
  asset_meter_unit: string | null;
  van_id: string | null;
  plant_id: string | null;
  hgv_id: string | null;
  workshop_task_categories: { name: string } | null;
}

interface SchemaSnapshotRow {
  snapshot_json: {
    sections?: Array<{
      section_key?: string;
      title?: string;
      description?: string | null;
      sort_order?: number;
      fields?: Array<{
        field_key?: string;
        label?: string;
        field_type?: string;
        is_required?: boolean;
        sort_order?: number;
      }>;
    }>;
  } | null;
}

interface FieldResponseRow {
  section_key: string;
  field_key: string;
  response_value: string | null;
  response_json: Record<string, unknown> | null;
}

interface MaintenanceMeterRow {
  current_hours?: number | null;
  current_mileage?: number | null;
}

function isStatusHistoryEvent(value: unknown): value is StatusHistoryEvent {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<StatusHistoryEvent>;
  return (
    candidate.type === 'status' &&
    typeof candidate.id === 'string' &&
    typeof candidate.status === 'string' &&
    typeof candidate.created_at === 'string'
  );
}

function getLatestCompletedStatusEvent(statusHistory: unknown[] | null | undefined): StatusHistoryEvent | null {
  if (!Array.isArray(statusHistory)) {
    return null;
  }

  return statusHistory
    .filter(isStatusHistoryEvent)
    .filter((event) => event.status === 'completed')
    .sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime())
    .at(-1) ?? null;
}

function getIsoDatePart(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function hasSignatureDateMismatch(
  sections: V2PdfSectionData[],
  completedAt: string | null
): boolean {
  const completedDate = getIsoDatePart(completedAt);
  if (!completedDate) {
    return false;
  }

  return sections.some((section) =>
    section.fields.some((field) => {
      if (field.field_type !== 'signature') {
        return false;
      }

      const signatureDate = getIsoDatePart(
        typeof field.response_json?.signed_at === 'string'
          ? field.response_json.signed_at
          : null
      );

      return Boolean(signatureDate && signatureDate !== completedDate);
    })
  );
}

function normalizeFieldType(
  fieldType: string | undefined
): 'marking_code' | 'text' | 'long_text' | 'number' | 'date' | 'yes_no' | 'signature' {
  if (fieldType === 'marking_code') return 'marking_code';
  if (fieldType === 'long_text') return 'long_text';
  if (fieldType === 'number') return 'number';
  if (fieldType === 'date') return 'date';
  if (fieldType === 'yes_no') return 'yes_no';
  if (fieldType === 'signature') return 'signature';
  return 'text';
}

function mapSnapshotToV2PdfSections(
  snapshot: SchemaSnapshotRow | null,
  fieldResponses: FieldResponseRow[],
): V2PdfSectionData[] {
  const snapshotSections = snapshot?.snapshot_json?.sections || [];
  if (!Array.isArray(snapshotSections) || snapshotSections.length === 0) return [];

  const responseMap = new Map(
    fieldResponses.map((response) => [`${response.section_key}::${response.field_key}`, response] as const),
  );

  return snapshotSections
    .slice()
    .sort((left, right) => Number(left.sort_order || 0) - Number(right.sort_order || 0))
    .map((section, sectionIndex) => {
      const sectionKey = section.section_key || `section_${sectionIndex + 1}`;
      const fields = (section.fields || [])
        .slice()
        .sort((left, right) => Number(left.sort_order || 0) - Number(right.sort_order || 0))
        .map((field, fieldIndex) => {
          const fieldKey = field.field_key || `field_${fieldIndex + 1}`;
          const response = responseMap.get(`${sectionKey}::${fieldKey}`);
          return {
            field_key: fieldKey,
            label: field.label || `Field ${fieldIndex + 1}`,
            field_type: normalizeFieldType(field.field_type),
            is_required: Boolean(field.is_required),
            response_value: response?.response_value || null,
            response_json: response?.response_json || null,
          };
        });
      return {
        section_key: sectionKey,
        title: section.title || `Section ${sectionIndex + 1}`,
        description: section.description || null,
        fields,
      };
    })
    .filter((section) => section.fields.length > 0);
}

async function normalizeSectionSignatureImages(
  sections: V2PdfSectionData[],
): Promise<V2PdfSectionData[]> {
  return Promise.all(
    sections.map(async (section) => ({
      ...section,
      fields: await Promise.all(
        section.fields.map(async (field) => {
          if (field.field_type !== 'signature') return field;
          const dataUrl = typeof field.response_json?.data_url === 'string'
            ? field.response_json.data_url
            : null;

          if (!dataUrl) return field;

          return {
            ...field,
            response_json: {
              ...field.response_json,
              data_url: await normalizeSignatureDataUrl(dataUrl, { width: 176, height: 58 }),
            },
          };
        }),
      ),
    })),
  );
}

/**
 * GET /api/workshop-tasks/attachments/[id]/pdf
 * Generate and download a PDF for a workshop task attachment.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: attachmentId } = await params;
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch attachment with template
    const { data: rawAttachment, error: attachmentError } = await supabase
      .from('workshop_task_attachments')
      .select(`
        *,
        workshop_attachment_templates (
          id,
          name,
          description
        )
      `)
      .eq('id', attachmentId)
      .single();

    if (attachmentError) {
      if (attachmentError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
      }
      throw attachmentError;
    }

    const attachment = rawAttachment as unknown as AttachmentRow;

    const [rawSnapshot, rawFieldResponses] = await Promise.all([
      getAdminSchemaSnapshotForAttachment(attachmentId),
      getAdminFieldResponsesForAttachment(attachmentId),
    ]);

    const snapshot = rawSnapshot as SchemaSnapshotRow | null;
    const fieldResponses = rawFieldResponses as unknown as FieldResponseRow[];
    const rawV2Sections = mapSnapshotToV2PdfSections(snapshot, fieldResponses);
    const v2Sections = await normalizeSectionSignatureImages(rawV2Sections);
    if (v2Sections.length === 0) {
      return NextResponse.json(
        { error: 'Attachment has no V2 schema data to render' },
        { status: 400 },
      );
    }

    // Fetch the parent task to get category and description
    const { data: rawTask, error: taskError } = await supabase
      .from('actions')
      .select(`
        id,
        title,
        status,
        created_at,
        actioned_at,
        status_history,
        workshop_comments,
        asset_meter_reading,
        asset_meter_unit,
        van_id,
        plant_id,
        hgv_id,
        workshop_task_categories (
          name
        )
      `)
      .eq('id', attachment.task_id)
      .single();

    if (taskError) {
      console.error('Error fetching parent task:', taskError);
    }

    const task = rawTask as unknown as TaskRow | null;

    // Try to get asset name for context
    let assetName: string | null = null;
    let assetType: 'van' | 'plant' | 'hgv' | null = null;
    let assetMeterReading = task?.asset_meter_reading ?? null;
    let assetMeterUnit = normalizeAssetMeterUnit(task?.asset_meter_unit ?? null);

    if (task?.van_id) {
      const { data: vehicle } = await supabase
        .from('vans')
        .select('reg_number, nickname')
        .eq('id', task.van_id)
        .single();
      if (vehicle) {
        assetName = (vehicle as { reg_number: string | null; nickname: string | null }).reg_number
          || (vehicle as { reg_number: string | null; nickname: string | null }).nickname
          || null;
        assetType = 'van';
      }
    } else if (task?.plant_id) {
      const { data: plant } = await supabase
        .from('plant')
        .select('plant_id, nickname, serial_number')
        .eq('id', task.plant_id)
        .single();
      if (plant) {
        const p = plant as { plant_id: string; nickname: string | null; serial_number: string | null };
        assetName = `${p.plant_id}${p.nickname ? ` (${p.nickname})` : ''}${p.serial_number ? ` (SN: ${p.serial_number})` : ''}`;
        assetType = 'plant';
      }
    } else if (task?.hgv_id) {
      const { data: hgv } = await supabase
        .from('hgvs')
        .select('reg_number, nickname')
        .eq('id', task.hgv_id)
        .single();
      if (hgv) {
        const typedHgv = hgv as { reg_number: string | null; nickname: string | null };
        assetName = typedHgv.reg_number || typedHgv.nickname || null;
        assetType = 'hgv';
      }
    }

    if (assetMeterReading == null && task) {
      const idColumn = task.plant_id ? 'plant_id' : task.hgv_id ? 'hgv_id' : task.van_id ? 'van_id' : null;
      const assetId = task.plant_id ?? task.hgv_id ?? task.van_id ?? null;
      const meterColumn = task.plant_id ? 'current_hours' : 'current_mileage';

      if (idColumn && assetId) {
        const { data: maintenance } = await supabase
          .from('vehicle_maintenance')
          .select(meterColumn)
          .eq(idColumn, assetId)
          .maybeSingle();

        const meterData = maintenance as MaintenanceMeterRow | null;
        assetMeterReading = meterColumn === 'current_hours'
          ? (meterData?.current_hours ?? null)
          : (meterData?.current_mileage ?? null);
      }
    }

    if (!assetMeterUnit) {
      assetMeterUnit = inferAssetMeterUnit(assetType);
    }

    const templateName = attachment.workshop_attachment_templates?.name || 'Attachment';
    const logoSrc = await loadTemplateLogoDataUrl();
    const reportCreatedAt = task?.created_at ?? attachment.created_at;
    const reportCompletedAt = task ? task.actioned_at : attachment.completed_at;
    const completedStatusEvent = getLatestCompletedStatusEvent(task?.status_history);
    const completedTimestampAdjusted = Boolean(completedStatusEvent?.meta?.timestamp_adjusted);
    const signatureTimestampOverride = reportCompletedAt && (
      completedTimestampAdjusted || hasSignatureDateMismatch(v2Sections, reportCompletedAt)
    )
      ? reportCompletedAt
      : null;

    // Generate PDF
    const pdfDocument = WorkshopAttachmentPDF({
      templateName,
      templateDescription: attachment.workshop_attachment_templates?.description || null,
      taskTitle: task?.workshop_comments || task?.title || '',
      taskCategory: task?.workshop_task_categories?.name || 'Workshop Task',
      taskStatus: task?.status || 'unknown',
      attachmentStatus: attachment.status,
      completedAt: reportCompletedAt,
      createdAt: reportCreatedAt,
      signatureTimestampOverride,
      signatureTimestampOverrideDateOnly: Boolean(signatureTimestampOverride),
      v2Sections,
      assetName,
      assetType,
      assetMeterReading,
      assetMeterUnit,
      logoSrc,
    });

    // Convert stream to buffer (same pattern as timesheets/[id]/pdf)
    const stream = await renderToStream(pdfDocument);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const pdfBytes = new Uint8Array(Buffer.concat(chunks));

    // Build a clean filename
    const safeTemplateName = templateName.replace(/[^a-z0-9]/gi, '_');
    const filename = `${safeTemplateName}_attachment.pdf`;

    return new NextResponse(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    const { id: attachmentId } = await params;
    console.error('Error generating attachment PDF:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/workshop-tasks/attachments/[id]/pdf',
      additionalData: {
        endpoint: `GET /api/workshop-tasks/attachments/${attachmentId}/pdf`,
      },
    });

    return NextResponse.json(
      { error: 'Failed to generate PDF' },
      { status: 500 }
    );
  }
}
