/**
 * Error Details API - Subcategory Tasks
 * 
 * Returns detailed information about tasks using a specific subcategory
 * Used when deletion is prevented due to foreign key constraints
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ErrorDetailsResponse, SubcategoryTaskItem } from '@/types/error-details';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const subcategoryId = searchParams.get('id');

    if (!subcategoryId) {
      return NextResponse.json(
        { error: 'Subcategory ID is required' },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Fetch the subcategory details
    const { data: subcategory, error: subcatError } = await supabase
      .from('workshop_task_subcategories')
      .select('id, name, slug')
      .eq('id', subcategoryId)
      .single();

    if (subcatError || !subcategory) {
      return NextResponse.json(
        { error: 'Subcategory not found' },
        { status: 404 }
      );
    }

    // Fetch all tasks using this subcategory
    const { data: tasks, error: tasksError } = await supabase
      .from('actions')
      .select(`
        id,
        title,
        status,
        created_at,
        vehicles:vans (
          reg_number,
          nickname
        )
      `)
      .eq('workshop_subcategory_id', subcategoryId)
      .order('created_at', { ascending: false });

    if (tasksError) {
      console.error('Error fetching tasks:', tasksError);
      return NextResponse.json(
        { error: 'Failed to fetch tasks' },
        { status: 500 }
      );
    }

    // Count tasks by status
    const statusBreakdown = tasks?.reduce((acc, task) => {
      const status = task.status || 'pending';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>) || {};

    // Format tasks for response
    const items: SubcategoryTaskItem[] = (tasks || []).map(task => ({
      id: task.id,
      title: task.title,
      status: task.status || 'pending',
      vehicle: {
        reg_number: (task.vehicles as { reg_number?: string | null; nickname?: string | null } | null)?.reg_number || 'Unknown',
        nickname: (task.vehicles as { reg_number?: string | null; nickname?: string | null } | null)?.nickname || null,
      },
      created_at: task.created_at || '',
      url: `/workshop-tasks?task=${task.id}`,
    }));

    // Build response
    const response: ErrorDetailsResponse<SubcategoryTaskItem> = {
      success: true,
      detailsType: 'subcategory-tasks',
      summary: {
        title: `Cannot delete "${subcategory.name}" subcategory`,
        description: `${items.length} task${items.length !== 1 ? 's are' : ' is'} currently using this subcategory`,
        count: items.length,
        subcategoryName: subcategory.name,
        statusBreakdown,
      },
      items,
      actions: [
        {
          id: 'view-all',
          label: 'View All Tasks',
          type: 'secondary',
        },
      ],
      resolutionGuide: [
        'Reassign these tasks to a different subcategory',
        'Delete or complete the tasks if no longer needed',
        'Tasks can be bulk-reassigned from the workshop tasks page',
      ],
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error in subcategory-tasks details API:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
