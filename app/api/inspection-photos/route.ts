import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sortInspectionPhotos } from '@/lib/inspection-photos';
import type { Database } from '@/types/database';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

type InspectionPhotoRow = Database['public']['Tables']['inspection_photos']['Row'];
type NormalizedInspectionPhotoRow = Omit<InspectionPhotoRow, 'created_at'> & { created_at: string };
type ActionRow = Database['public']['Tables']['actions']['Row'];
type InspectionItemRow = Database['public']['Tables']['inspection_items']['Row'];

function normalizeInspectionPhoto(photo: InspectionPhotoRow): NormalizedInspectionPhotoRow {
  return {
    ...photo,
    created_at: photo.created_at ?? '',
  };
}

function createServiceRoleClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

function parseOptionalInt(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

async function canAccessInspection(inspectionId: string) {
  const supabase = await createClient();

  const [vanInspection, plantInspection, hgvInspection] = await Promise.all([
    supabase.from('van_inspections').select('id').eq('id', inspectionId).maybeSingle(),
    supabase.from('plant_inspections').select('id').eq('id', inspectionId).maybeSingle(),
    supabase.from('hgv_inspections').select('id').eq('id', inspectionId).maybeSingle(),
  ]);

  return Boolean(vanInspection.data || plantInspection.data || hgvInspection.data);
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const inspectionId = request.nextUrl.searchParams.get('inspectionId');
  const itemNumber = parseOptionalInt(request.nextUrl.searchParams.get('itemNumber'));
  const dayOfWeek = parseOptionalInt(request.nextUrl.searchParams.get('dayOfWeek'));

  if (!inspectionId) {
    return NextResponse.json({ error: 'inspectionId is required' }, { status: 400 });
  }

  const canAccess = await canAccessInspection(inspectionId);
  if (!canAccess) {
    return NextResponse.json({ error: 'Inspection not found' }, { status: 404 });
  }

  const serviceRole = createServiceRoleClient();
  let query = serviceRole
    .from('inspection_photos')
    .select('id, inspection_id, item_number, day_of_week, photo_url, caption, created_at')
    .eq('inspection_id', inspectionId)
    .order('created_at', { ascending: false });

  if (itemNumber !== null) {
    query = query.eq('item_number', itemNumber);
  }

  if (dayOfWeek !== null) {
    query = query.eq('day_of_week', dayOfWeek);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ photos: (data ?? []).map(normalizeInspectionPhoto) });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { taskIds?: string[] } | null;
  const taskIds = Array.from(new Set((body?.taskIds ?? []).filter(Boolean)));

  if (taskIds.length === 0) {
    return NextResponse.json({ photosByTask: {} });
  }

  const { data: visibleTasks, error: visibleTasksError } = await supabase
    .from('actions')
    .select('id')
    .in('id', taskIds);

  if (visibleTasksError) {
    return NextResponse.json({ error: visibleTasksError.message }, { status: 500 });
  }

  const allowedTaskIds = (visibleTasks ?? []).map((task) => task.id);
  if (allowedTaskIds.length === 0) {
    return NextResponse.json({ photosByTask: {} });
  }

  const serviceRole = createServiceRoleClient();
  const { data: tasks, error: tasksError } = await serviceRole
    .from('actions')
    .select('id, action_type, inspection_id, inspection_item_id')
    .in('id', allowedTaskIds)
    .eq('action_type', 'inspection_defect');

  if (tasksError) {
    return NextResponse.json({ error: tasksError.message }, { status: 500 });
  }

  const typedTasks = (tasks ?? []) as Pick<ActionRow, 'id' | 'action_type' | 'inspection_id' | 'inspection_item_id'>[];
  const itemIds = Array.from(
    new Set(typedTasks.map((task) => task.inspection_item_id).filter(Boolean))
  ) as string[];

  if (itemIds.length === 0) {
    return NextResponse.json({ photosByTask: {} });
  }

  const { data: items, error: itemsError } = await serviceRole
    .from('inspection_items')
    .select('id, inspection_id, item_number, day_of_week')
    .in('id', itemIds);

  if (itemsError) {
    return NextResponse.json({ error: itemsError.message }, { status: 500 });
  }

  const typedItems = (items ?? []) as Pick<
    InspectionItemRow,
    'id' | 'inspection_id' | 'item_number' | 'day_of_week'
  >[];
  const itemsById = new Map(typedItems.map((item) => [item.id, item]));
  const inspectionIds = Array.from(
    new Set(
      typedTasks
        .map((task) => task.inspection_id)
        .filter((inspectionId): inspectionId is string => Boolean(inspectionId))
    )
  );

  if (inspectionIds.length === 0) {
    return NextResponse.json({ photosByTask: {} });
  }

  const { data: photos, error: photosError } = await serviceRole
    .from('inspection_photos')
    .select('id, inspection_id, item_number, day_of_week, photo_url, caption, created_at')
    .in('inspection_id', inspectionIds)
    .order('created_at', { ascending: false });

  if (photosError) {
    return NextResponse.json({ error: photosError.message }, { status: 500 });
  }

  const typedPhotos = (photos ?? []).map(normalizeInspectionPhoto);

  const photosByInspection = typedPhotos.reduce<Record<string, NormalizedInspectionPhotoRow[]>>((acc, photo) => {
    if (!acc[photo.inspection_id]) {
      acc[photo.inspection_id] = [];
    }

    acc[photo.inspection_id].push(photo);
    return acc;
  }, {});

  const photosByTask = typedTasks.reduce<Record<string, NormalizedInspectionPhotoRow[]>>((acc, task) => {
    const inspectionItem = task.inspection_item_id ? itemsById.get(task.inspection_item_id) : null;
    if (!inspectionItem || !task.inspection_id) {
      acc[task.id] = [];
      return acc;
    }

    const inspectionPhotos = photosByInspection[task.inspection_id] ?? [];
    const exactMatches = inspectionPhotos.filter(
      (photo) =>
        photo.item_number === inspectionItem.item_number &&
        photo.day_of_week === inspectionItem.day_of_week
    );

    const fallbackMatches =
      exactMatches.length === 0 && inspectionItem.day_of_week !== null
        ? inspectionPhotos.filter(
            (photo) =>
              photo.item_number === inspectionItem.item_number && photo.day_of_week === null
          )
        : [];

    acc[task.id] = sortInspectionPhotos(
      exactMatches.length > 0 ? exactMatches : fallbackMatches
    ) as NormalizedInspectionPhotoRow[];
    return acc;
  }, {});

  return NextResponse.json({ photosByTask });
}
