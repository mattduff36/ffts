import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { resolveTestVanId } from './helpers/test-assets';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const shouldSkip = !supabaseUrl || !supabaseKey || (!supabaseUrl.includes('localhost') && !supabaseUrl.includes('127.0.0.1') && !supabaseUrl.includes('staging'));
const describeOrSkip = shouldSkip ? describe.skip : describe;

describeOrSkip('Workshop Attachments V2 schema compatibility', () => {
  let supabase: SupabaseClient;
  let testUserId: string;
  let testVanId: string;
  let testTaskId: string;
  let testTemplateId: string;
  let testVersionId: string;
  let testSectionId: string;
  let testFieldId: string;
  let testAttachmentId: string;
  let testSnapshotId: string;

  beforeAll(async () => {
    supabase = createClient(supabaseUrl!, supabaseKey!);
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: process.env.TEST_USER_EMAIL || 'test@example.com',
      password: process.env.TEST_USER_PASSWORD || 'test123456',
    });
    if (authError) throw authError;
    testUserId = authData.user!.id;

    testVanId = (await resolveTestVanId(supabase)) || '';
    if (!testVanId) throw new Error('No ZZ99 test van available');
  });

  afterAll(async () => {
    if (testSnapshotId) {
      await supabase.from('workshop_attachment_schema_snapshots').delete().eq('id', testSnapshotId);
    }
    if (testAttachmentId) {
      await supabase.from('workshop_task_attachments').delete().eq('id', testAttachmentId);
    }
    if (testTaskId) {
      await supabase.from('actions').delete().eq('id', testTaskId);
    }
    if (testVersionId) {
      await supabase.from('workshop_attachment_template_versions').delete().eq('id', testVersionId);
    }
    if (testTemplateId) {
      await supabase.from('workshop_attachment_templates').delete().eq('id', testTemplateId);
    }
    await supabase.auth.signOut();
  });

  it('stores immutable schema snapshots independent of later template edits', async () => {
    const { data: template, error: templateError } = await supabase
      .from('workshop_attachment_templates')
      .insert({
        name: `V2 Integration Template ${Date.now()}`,
        description: 'Integration test template',
        is_active: true,
        created_by: testUserId,
      })
      .select('*')
      .single();
    expect(templateError).toBeNull();
    testTemplateId = template!.id;

    const { data: version, error: versionError } = await supabase
      .from('workshop_attachment_template_versions')
      .insert({
        template_id: testTemplateId,
        version_number: 1,
        status: 'published',
        created_by: testUserId,
      })
      .select('*')
      .single();
    expect(versionError).toBeNull();
    testVersionId = version!.id;

    const { data: section, error: sectionError } = await supabase
      .from('workshop_attachment_template_sections')
      .insert({
        version_id: testVersionId,
        section_key: 'general',
        title: 'General',
        sort_order: 1,
      })
      .select('*')
      .single();
    expect(sectionError).toBeNull();
    testSectionId = section!.id;

    const { data: field, error: fieldError } = await supabase
      .from('workshop_attachment_template_fields')
      .insert({
        section_id: testSectionId,
        field_key: 'inspector_signature',
        label: 'Inspector Signature',
        field_type: 'signature',
        is_required: true,
        sort_order: 1,
      })
      .select('*')
      .single();
    expect(fieldError).toBeNull();
    testFieldId = field!.id;

    const { data: task, error: taskError } = await supabase
      .from('actions')
      .insert({
        action_type: 'workshop_vehicle_task',
        van_id: testVanId,
        title: 'V2 Snapshot Integration Task',
        description: 'Snapshot test',
        status: 'pending',
        priority: 'medium',
        created_by: testUserId,
      })
      .select('id')
      .single();
    expect(taskError).toBeNull();
    testTaskId = task!.id;

    const { data: attachment, error: attachmentError } = await supabase
      .from('workshop_task_attachments')
      .insert({
        task_id: testTaskId,
        template_id: testTemplateId,
        created_by: testUserId,
      })
      .select('*')
      .single();
    expect(attachmentError).toBeNull();
    testAttachmentId = attachment!.id;

    const snapshotJson = {
      template_id: testTemplateId,
      version_id: testVersionId,
      generated_at: new Date().toISOString(),
      sections: [
        {
          id: testSectionId,
          section_key: 'general',
          title: 'General',
          description: null,
          sort_order: 1,
          fields: [
            {
              id: testFieldId,
              field_key: 'inspector_signature',
              label: 'Inspector Signature',
              help_text: null,
              field_type: 'signature',
              is_required: true,
              sort_order: 1,
              options_json: null,
              validation_json: null,
            },
          ],
        },
      ],
    };

    const { data: snapshot, error: snapshotError } = await supabase
      .from('workshop_attachment_schema_snapshots')
      .insert({
        attachment_id: testAttachmentId,
        template_version_id: testVersionId,
        snapshot_json: snapshotJson,
        created_by: testUserId,
      })
      .select('*')
      .single();
    expect(snapshotError).toBeNull();
    testSnapshotId = snapshot!.id;

    const { error: fieldUpdateError } = await supabase
      .from('workshop_attachment_template_fields')
      .update({ label: 'Inspector Sign-Off (Updated)' })
      .eq('id', testFieldId);
    expect(fieldUpdateError).toBeNull();

    const { data: refreshedSnapshot, error: refreshedSnapshotError } = await supabase
      .from('workshop_attachment_schema_snapshots')
      .select('*')
      .eq('id', testSnapshotId)
      .single();
    expect(refreshedSnapshotError).toBeNull();

    const savedLabel = refreshedSnapshot!.snapshot_json.sections[0].fields[0].label;
    expect(savedLabel).toBe('Inspector Signature');
  });
});
