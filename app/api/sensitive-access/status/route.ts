import { NextRequest, NextResponse } from 'next/server';
import { ALL_MODULES, type ModuleName, type SensitiveAccessModuleName } from '@/types/roles';
import { canCurrentUserAccessDebugConsole, createDebugAccessErrorBody } from '@/lib/server/debug-console-access';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { getSensitiveModulePinState } from '@/lib/server/sensitive-pin';

export async function GET(request: NextRequest) {
  try {
    const moduleName = new URL(request.url).searchParams.get('module');
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
      ? await getSensitiveModulePinState(moduleName as SensitiveAccessModuleName, debugAccessContext)
      : await getSensitiveModulePinState(moduleName as SensitiveAccessModuleName);
    return NextResponse.json({ success: true, state });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load sensitive access status';
    return NextResponse.json(
      { error: message },
      { status: message === 'Unauthorized' ? 401 : 500 }
    );
  }
}
