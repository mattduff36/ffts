import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    { error: 'Sensitive PIN changes require an administrator reset before you can set a new PIN.' },
    { status: 403 }
  );
}
