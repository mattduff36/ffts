import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import {
  WORKSHOP_DISPLAY_BOARD_KEY,
  cancelDisplayBoardPairing,
  confirmDisplayBoardPairing,
  getDisplayBoardAdminState,
  revokeDisplayBoardDevice,
  startDisplayBoardPairing,
  updateDisplayBoardConfig,
  updateDisplayBoardDeviceTextSize,
} from '@/lib/server/display-board';

async function requireAdminSettingsUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      userId: null,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const canAccessSettings = await canEffectiveRoleAccessModule('admin-settings');
  if (!canAccessSettings) {
    return {
      userId: user.id,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  return { userId: user.id, response: null };
}

export async function GET() {
  const context = await requireAdminSettingsUser();
  if (context.response) return context.response;

  try {
    const state = await getDisplayBoardAdminState(WORKSHOP_DISPLAY_BOARD_KEY);
    return NextResponse.json({ success: true, ...state });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load display board settings' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const context = await requireAdminSettingsUser();
  if (context.response) return context.response;

  try {
    const body = await request.json() as {
      fallback_poll_interval_seconds?: unknown;
      realtime_debounce_ms?: unknown;
      is_enabled?: unknown;
    };
    await updateDisplayBoardConfig(body, WORKSHOP_DISPLAY_BOARD_KEY);
    const state = await getDisplayBoardAdminState(WORKSHOP_DISPLAY_BOARD_KEY);
    return NextResponse.json({ success: true, ...state });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update display board settings' },
      { status: 400 }
    );
  }
}

export async function POST(request: NextRequest) {
  const context = await requireAdminSettingsUser();
  if (context.response) return context.response;
  if (!context.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json() as {
      action?: 'start_pairing' | 'cancel_pairing' | 'confirm_pairing' | 'revoke_device' | 'update_device_text_size';
      session_id?: string;
      confirmation_code?: string;
      device_id?: string;
      display_text_size_step?: unknown;
    };

    if (body.action === 'start_pairing') {
      await startDisplayBoardPairing(context.userId, WORKSHOP_DISPLAY_BOARD_KEY);
    } else if (body.action === 'cancel_pairing') {
      await cancelDisplayBoardPairing(WORKSHOP_DISPLAY_BOARD_KEY);
    } else if (body.action === 'confirm_pairing') {
      if (!body.session_id || !body.confirmation_code) {
        return NextResponse.json({ error: 'session_id and confirmation_code are required' }, { status: 400 });
      }
      await confirmDisplayBoardPairing(
        context.userId,
        body.session_id,
        body.confirmation_code.trim(),
        WORKSHOP_DISPLAY_BOARD_KEY
      );
    } else if (body.action === 'revoke_device') {
      if (!body.device_id) {
        return NextResponse.json({ error: 'device_id is required' }, { status: 400 });
      }
      await revokeDisplayBoardDevice(body.device_id, context.userId, WORKSHOP_DISPLAY_BOARD_KEY);
    } else if (body.action === 'update_device_text_size') {
      if (!body.device_id) {
        return NextResponse.json({ error: 'device_id is required' }, { status: 400 });
      }
      await updateDisplayBoardDeviceTextSize(
        body.device_id,
        body.display_text_size_step,
        WORKSHOP_DISPLAY_BOARD_KEY
      );
    } else {
      return NextResponse.json({ error: 'Unsupported display board action' }, { status: 400 });
    }

    const state = await getDisplayBoardAdminState(WORKSHOP_DISPLAY_BOARD_KEY);
    return NextResponse.json({ success: true, ...state });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update display board pairing' },
      { status: 400 }
    );
  }
}
