import type { NextResponse } from 'next/server';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';

export async function requireAdminUsersModuleAccess(): Promise<NextResponse | null> {
  return requireSensitiveModuleAccess('admin-users');
}
