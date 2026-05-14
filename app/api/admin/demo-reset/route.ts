import { spawn } from 'child_process';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { templateConfig } from '@/lib/config/template-config';
import { getTemplateSuperAdminEmail } from '@/lib/config/template-server-config';

function getProjectRef(supabaseUrl: string): string | null {
  return supabaseUrl.match(/^https:\/\/([^.]+)\.supabase\.co$/)?.[1] ?? null;
}

function isDemoProjectAllowed(): boolean {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const expectedProjectRef = process.env.DEMO_SUPABASE_PROJECT_REF || '';
  const actualProjectRef = getProjectRef(supabaseUrl);
  const isLocalProject = supabaseUrl.includes('localhost') || supabaseUrl.includes('127.0.0.1');

  return isLocalProject || (!!actualProjectRef && actualProjectRef === expectedProjectRef);
}

async function isSuperAdmin(userId: string, email?: string | null): Promise<boolean> {
  if (email && email === getTemplateSuperAdminEmail()) return true;

  const admin = createAdminClient();
  const { data } = await admin
    .from('profiles')
    .select('super_admin, role:roles(is_super_admin)')
    .eq('id', userId)
    .maybeSingle();

  const profile = data as
    | { super_admin?: boolean | null; role?: { is_super_admin?: boolean | null } | null }
    | null;

  return profile?.super_admin === true || profile?.role?.is_super_admin === true;
}

export async function POST() {
  if (!templateConfig.isDemoMode) {
    return NextResponse.json({ error: 'Demo reset is only available in demo mode.' }, { status: 404 });
  }

  if (!isDemoProjectAllowed()) {
    return NextResponse.json({ error: 'Demo reset project guard is not configured.' }, { status: 403 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!(await isSuperAdmin(user.id, user.email))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      send({ stage: 'Starting guarded demo reset', progress: 5 });

      const child = spawn('npm', ['run', 'demo:reset'], {
        cwd: process.cwd(),
        shell: process.platform === 'win32',
        env: {
          ...process.env,
          DEMO_RESET_CONFIRM: 'RESET_DEMO_DATA',
        },
      });

      child.stdout.on('data', (chunk: Buffer) => {
        send({ stage: chunk.toString().trim(), progress: 50 });
      });

      child.stderr.on('data', (chunk: Buffer) => {
        send({ stage: chunk.toString().trim(), progress: 50, warning: true });
      });

      child.on('exit', (code) => {
        if (code === 0) {
          send({ stage: 'Demo reset complete', progress: 100, success: true });
        } else {
          send({ error: `Demo reset failed with code ${code}`, progress: 100 });
        }
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
