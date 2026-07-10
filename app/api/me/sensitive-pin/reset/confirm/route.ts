import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    { error: 'Sensitive PIN resets must be started by an administrator.' },
    { status: 403 }
  );
}
