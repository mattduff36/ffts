import type { SupabaseClient } from '@supabase/supabase-js';
import type { ScheduleJobTag } from '@/types/scheduling';

export function normalizeScheduleJobTag(row: Record<string, unknown>): ScheduleJobTag {
  return {
    id: String(row.id),
    name: String(row.name),
    color: typeof row.color === 'string' ? row.color : 'slate',
    description: typeof row.description === 'string' ? row.description : null,
    is_active: row.is_active !== false,
  };
}

export async function loadScheduleJobTags(
  admin: SupabaseClient,
  includeInactive = false
): Promise<ScheduleJobTag[]> {
  let query = admin
    .from('schedule_job_tags')
    .select('id, name, color, description, is_active')
    .order('name');
  if (!includeInactive) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) throw error;
  return ((data || []) as Array<Record<string, unknown>>).map(normalizeScheduleJobTag);
}

export async function loadTagsForScheduleJob(
  admin: SupabaseClient,
  jobId: string
): Promise<ScheduleJobTag[]> {
  const { data, error } = await admin
    .from('schedule_job_tag_links')
    .select('tag:schedule_job_tags(id, name, color, description, is_active)')
    .eq('job_id', jobId);
  if (error) throw error;

  return ((data || []) as Array<{ tag: Record<string, unknown> | Record<string, unknown>[] | null }>)
    .flatMap((link) => {
      const tag = Array.isArray(link.tag) ? link.tag[0] : link.tag;
      return tag ? [normalizeScheduleJobTag(tag)] : [];
    });
}

export async function syncScheduleJobTags(
  admin: SupabaseClient,
  jobId: string,
  tagIds: string[],
  userId: string
): Promise<void> {
  const uniqueTagIds = Array.from(new Set(tagIds));
  if (uniqueTagIds.length > 0) {
    const validation = await admin
      .from('schedule_job_tags')
      .select('id')
      .in('id', uniqueTagIds)
      .eq('is_active', true);
    if (validation.error) throw validation.error;
    if ((validation.data || []).length !== uniqueTagIds.length) {
      throw new Error('One or more selected job tags are unavailable.');
    }
  }

  const deletion = await admin
    .from('schedule_job_tag_links')
    .delete()
    .eq('job_id', jobId);
  if (deletion.error) throw deletion.error;

  if (uniqueTagIds.length === 0) return;
  const insertion = await admin.from('schedule_job_tag_links').insert(
    uniqueTagIds.map((tagId) => ({
      job_id: jobId,
      tag_id: tagId,
      created_by: userId,
    }))
  );
  if (insertion.error) throw insertion.error;
}
