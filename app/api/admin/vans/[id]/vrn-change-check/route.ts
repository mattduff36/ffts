import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';
import { createDVLAApiService } from '@/lib/services/dvla-api';
import { createMotHistoryService } from '@/lib/services/mot-history-api';
import { compareVrnChange } from '@/lib/services/vrn-change-comparison';
import { formatRegistrationForStorage, validateRegistrationNumber } from '@/lib/utils/registration';

interface VrnChangeCheckBody {
  new_reg_number?: string;
}

function normalizeRegistration(registrationNumber: string): string {
  return registrationNumber.replace(/\s+/g, '').trim().toUpperCase();
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const effectiveRole = await getEffectiveRole();

    if (!effectiveRole.user_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canManageFleet = await canEffectiveRoleAccessModule('admin-vans');
    if (!canManageFleet) {
      return NextResponse.json(
        { error: 'Forbidden: Fleet admin access required' },
        { status: 403 }
      );
    }

    const { new_reg_number } = (await request.json()) as VrnChangeCheckBody;
    if (!new_reg_number) {
      return NextResponse.json(
        { error: 'New registration number is required' },
        { status: 400 }
      );
    }

    const validationError = validateRegistrationNumber(new_reg_number);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const vanId = (await params).id;
    const supabase = await createServerClient();
    const { data: van, error: vanError } = await supabase
      .from('vans')
      .select('id, reg_number')
      .eq('id', vanId)
      .single();

    if (vanError) throw vanError;

    if (!van?.reg_number) {
      return NextResponse.json({ error: 'Van not found' }, { status: 404 });
    }

    const formattedNewRegistration = formatRegistrationForStorage(new_reg_number);
    if (normalizeRegistration(van.reg_number) === normalizeRegistration(formattedNewRegistration)) {
      return NextResponse.json({
        success: true,
        requiresConfirmation: false,
        comparison: null,
      });
    }

    const dvlaService = createDVLAApiService();
    if (!dvlaService) {
      return NextResponse.json(
        { error: 'DVLA API not configured' },
        { status: 503 }
      );
    }

    const comparison = await compareVrnChange(van.reg_number, formattedNewRegistration, {
      dvlaService,
      motService: createMotHistoryService(),
    });

    return NextResponse.json({
      success: true,
      requiresConfirmation: comparison.hasDifferences || comparison.warnings.length > 0,
      comparison,
    });
  } catch (error) {
    console.error('Error checking van VRN change:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/vans/[id]/vrn-change-check',
      additionalData: {
        endpoint: '/api/admin/vans/[id]/vrn-change-check',
        method: 'POST',
      },
    });

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
