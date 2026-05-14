import { config } from 'dotenv';
import { resolve } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import pg from 'pg';
import { renderToStream } from '@react-pdf/renderer';
import {
  WorkshopAttachmentPDF,
  type V2PdfSectionData,
} from '../lib/pdf/workshop-attachment-pdf';
import { loadTemplateLogoDataUrl } from '../lib/pdf/template-logo';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('Missing POSTGRES_URL_NON_POOLING or POSTGRES_URL in .env.local');
  process.exit(1);
}

interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  applies_to: string[] | null;
}

interface VersionRow {
  id: string;
  status: string;
  version_number: number;
}

interface SectionRow {
  id: string;
  section_key: string;
  title: string;
  description: string | null;
  sort_order: number;
}

interface FieldRow {
  section_id: string;
  field_key: string;
  label: string;
  field_type: 'marking_code' | 'text' | 'long_text' | 'number' | 'date' | 'yes_no' | 'signature';
  is_required: boolean;
  sort_order: number;
  validation_json: Record<string, unknown> | null;
}

interface PreviewManifestItem {
  template_id: string;
  template_name: string;
  source: 'v2_schema' | 'empty';
  section_count: number;
  field_count: number;
  file: string;
}

interface PreviewManifest {
  generated_at: string;
  output_dir: string;
  template_count: number;
  previews: PreviewManifestItem[];
}

const DUMMY_SIGNATURE_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';

function toFileSlug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || 'template';
}

function selectAssetType(appliesTo: string[] | null): 'van' | 'plant' | 'hgv' | null {
  if (!appliesTo || appliesTo.length === 0) return null;
  if (appliesTo.includes('hgv')) return 'hgv';
  if (appliesTo.includes('plant')) return 'plant';
  if (appliesTo.includes('vehicle') || appliesTo.includes('van')) return 'van';
  return null;
}

function selectAssetName(assetType: 'van' | 'plant' | 'hgv' | null): string | null {
  if (assetType === 'hgv') return 'HGV-TEST-001';
  if (assetType === 'plant') return 'PLANT-TEST-001 (Demo Excavator)';
  if (assetType === 'van') return 'VN-TEST-001';
  return null;
}

function selectAssetMeterReading(assetType: 'van' | 'plant' | 'hgv' | null): number | null {
  if (assetType === 'plant') return 1450;
  if (assetType === 'hgv') return 128000;
  if (assetType === 'van') return 84215;
  return null;
}

function selectAssetMeterUnit(assetType: 'van' | 'plant' | 'hgv' | null): 'miles' | 'km' | 'hours' | null {
  if (assetType === 'plant') return 'hours';
  if (assetType === 'hgv') return 'km';
  if (assetType === 'van') return 'miles';
  return null;
}

function buildDummyResponseValue(
  fieldType: V2PdfSectionData['fields'][number]['field_type'],
  label: string,
  index: number,
  _validationJson: Record<string, unknown> | null,
): { response_value: string | null; response_json: Record<string, unknown> | null } {
  if (fieldType === 'marking_code') {
    const cycle = ['serviceable', 'attention', 'not_applicable'];
    return {
      response_value: cycle[index % cycle.length],
      response_json: null,
    };
  }

  if (fieldType === 'yes_no') {
    const values = ['yes', 'no', 'na'];
    return {
      response_value: values[index % values.length],
      response_json: null,
    };
  }

  if (fieldType === 'date') {
    return {
      response_value: '2026-04-01',
      response_json: null,
    };
  }

  if (fieldType === 'number') {
    return {
      response_value: String((index % 9) + 1),
      response_json: null,
    };
  }

  if (fieldType === 'long_text') {
    return {
      response_value: `Dummy notes for ${label}. This is a sample multiline-style response.`,
      response_json: null,
    };
  }

  if (fieldType === 'signature') {
    return {
      response_value: 'Preview Inspector',
      response_json: {
        data_url: DUMMY_SIGNATURE_DATA_URL,
        signed_by_name: 'Preview Inspector',
        signed_at: '2026-04-01T10:30:00.000Z',
      },
    };
  }

  return {
    response_value: `Sample response for ${label}`,
    response_json: null,
  };
}

async function renderPdfBytes(documentNode: ReturnType<typeof WorkshopAttachmentPDF>): Promise<Uint8Array> {
  const stream = await renderToStream(documentNode);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return new Uint8Array(Buffer.concat(chunks));
}

async function loadV2Sections(client: pg.Client, templateId: string): Promise<V2PdfSectionData[]> {
  const versionsResult = await client.query<VersionRow>(
    `select id, status, version_number
     from workshop_attachment_template_versions
     where template_id = $1
     order by version_number desc`,
    [templateId],
  );
  if (versionsResult.rows.length === 0) return [];

  const published = versionsResult.rows.find((version) => version.status === 'published');
  const selectedVersion = published || versionsResult.rows[0];

  const sectionsResult = await client.query<SectionRow>(
    `select id, section_key, title, description, sort_order
     from workshop_attachment_template_sections
     where version_id = $1
     order by sort_order asc`,
    [selectedVersion.id],
  );
  if (sectionsResult.rows.length === 0) return [];

  const sectionIds = sectionsResult.rows.map((section) => section.id);
  const fieldsResult = await client.query<FieldRow>(
    `select section_id, field_key, label, field_type, is_required, sort_order, validation_json
     from workshop_attachment_template_fields
     where section_id = any($1::uuid[])
     order by sort_order asc`,
    [sectionIds],
  );

  const fieldsBySectionId = new Map<string, FieldRow[]>();
  for (const field of fieldsResult.rows) {
    const list = fieldsBySectionId.get(field.section_id) || [];
    list.push(field);
    fieldsBySectionId.set(field.section_id, list);
  }

  let fieldIndex = 0;
  return sectionsResult.rows.map((section) => {
    const sectionFields = fieldsBySectionId.get(section.id) || [];
    const fields = sectionFields.map((field) => {
      const dummy = buildDummyResponseValue(field.field_type, field.label, fieldIndex, field.validation_json);
      fieldIndex += 1;
      return {
        field_key: field.field_key,
        label: field.label,
        field_type: field.field_type,
        is_required: field.is_required,
        response_value: dummy.response_value,
        response_json: dummy.response_json,
      };
    });

    return {
      section_key: section.section_key,
      title: section.title,
      description: section.description,
      fields,
    };
  });
}

async function run() {
  const url = new URL(connectionString as string);
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('Connecting to database...');
    await client.connect();
    console.log('Connected');

    const templatesResult = await client.query<TemplateRow>(
      `select id, name, description, applies_to
       from workshop_attachment_templates
       order by lower(name) asc`,
    );

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputDir = resolve(process.cwd(), 'reports', 'workshop-attachments', 'pdf-previews', timestamp);
    const logoSrc = await loadTemplateLogoDataUrl();
    mkdirSync(outputDir, { recursive: true });

    const previews: PreviewManifestItem[] = [];

    for (let index = 0; index < templatesResult.rows.length; index += 1) {
      const template = templatesResult.rows[index];
      const v2Sections = await loadV2Sections(client, template.id);
      const source: PreviewManifestItem['source'] = v2Sections.length > 0 ? 'v2_schema' : 'empty';

      const assetType = selectAssetType(template.applies_to);
      const assetName = selectAssetName(assetType);
      const assetMeterReading = selectAssetMeterReading(assetType);
      const assetMeterUnit = selectAssetMeterUnit(assetType);
      const documentNode = WorkshopAttachmentPDF({
        templateName: template.name,
        templateDescription: template.description,
        taskTitle: 'Preview export generated with deterministic dummy responses.',
        taskCategory: 'Workshop Task',
        taskStatus: 'in_progress',
        attachmentStatus: 'pending',
        completedAt: null,
        createdAt: '2026-04-01T09:00:00.000Z',
        v2Sections,
        assetType,
        assetName,
        assetMeterReading,
        assetMeterUnit,
        logoSrc,
      });

      const pdfBytes = await renderPdfBytes(documentNode);
      const fileName = `${String(index + 1).padStart(2, '0')}-${toFileSlug(template.name)}.pdf`;
      const filePath = resolve(outputDir, fileName);
      writeFileSync(filePath, Buffer.from(pdfBytes));

      const fieldCount = v2Sections.reduce((count, section) => count + section.fields.length, 0);
      previews.push({
        template_id: template.id,
        template_name: template.name,
        source,
        section_count: v2Sections.length,
        field_count: fieldCount,
        file: filePath,
      });
      console.log(`Exported preview: ${template.name} -> ${fileName} (${source})`);
    }

    const manifest: PreviewManifest = {
      generated_at: new Date().toISOString(),
      output_dir: outputDir,
      template_count: previews.length,
      previews,
    };

    const manifestFile = resolve(outputDir, 'manifest.json');
    writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), 'utf-8');
    const latestManifestFile = resolve(process.cwd(), 'reports', 'workshop-attachments', 'pdf-previews', 'latest-manifest.json');
    writeFileSync(latestManifestFile, JSON.stringify(manifest, null, 2), 'utf-8');
    console.log(`Preview manifest: ${manifestFile}`);
    console.log(`Latest manifest alias: ${latestManifestFile}`);
    console.log(`Template previews exported: ${previews.length}`);
  } catch (error) {
    const pgError = error as { message?: string; detail?: string; hint?: string };
    console.error('Preview export failed:', pgError.message || error);
    if (pgError.detail) console.error('Detail:', pgError.detail);
    if (pgError.hint) console.error('Hint:', pgError.hint);
    process.exit(1);
  } finally {
    await client.end();
    console.log('Database connection closed');
  }
}

run();
