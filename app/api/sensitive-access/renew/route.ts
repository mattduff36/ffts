import { NextRequest, NextResponse } from 'next/server';
import { ALL_MODULES, type ModuleName, type SensitiveAccessModuleName } from '@/types/roles';
import { canCurrentUserAccessDebugConsole, createDebugAccessErrorBody } from '@/lib/server/debug-console-access';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { renewSensitiveModuleAccess } from '@/lib/server/sensitive-pin';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as {
      module?: string;
    } | null;
    const moduleName = body?.module;
    let debugAccessContext: Awaited<ReturnType<typeof canCurrentUserAccessDebugConsole>>['currentContext'] | undefined;
    const isDebugModule = moduleName === 'debug';
    if (!moduleName || (!isDebugModule && !ALL_MODULES.includes(moduleName as ModuleName))) {
      return NextResponse.json({ error: 'Unknown module' }, { status: 400 });
    }

    if (isDebugModule) {
      const access = await canCurrentUserAccessDebugConsole();
      if (!access.ok) {
        return NextResponse.json(createDebugAccessErrorBody(access), { status: access.status });
      }
      debugAccessContext = access.currentContext;
    } else {
      const canAccess = await canEffectiveRoleAccessModule(moduleName as ModuleName);
      if (!canAccess) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const state = debugAccessContext
      ? await renewSensitiveModuleAccess(moduleName as SensitiveAccessModuleName, debugAccessContext)
      : await renewSensitiveModuleAccess(moduleName as SensitiveAccessModuleName);
    return NextResponse.json({ success: true, state });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to renew sensitive module access';
    const status = message === 'Unauthorized'
      ? 401
      : message === 'Sensitive access PIN required for protected modules.'
        ? 428
        : 400;

    return NextResponse.json(
      {
        error: message,
        code: status === 428 ? 'SENSITIVE_PIN_REQUIRED' : undefined,
      },
      { status }
    );
  }
}
