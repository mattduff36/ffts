import { NextResponse } from 'next/server';
import { renderToStream } from '@react-pdf/renderer';
import releaseHistoryJson from '@/lib/config/release-history.json';
import { VersionHistoryPDF } from '@/lib/pdf/version-history-pdf';
import { createClient } from '@/lib/supabase/server';
import type { ReleaseHistoryEntry } from '@/lib/config/release-version-logic';
import {
  filterReleaseHistoryEntriesForAccess,
  getCurrentReleaseHistoryAccess,
} from '@/lib/server/version-history-filter';

export const runtime = 'nodejs';

function buildPdfFilename(): string {
  const date = new Date().toISOString().slice(0, 10);
  return `squireapp-version-history-${date}.pdf`;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const access = await getCurrentReleaseHistoryAccess();
    const pdfComponent = VersionHistoryPDF({
      entries: filterReleaseHistoryEntriesForAccess(releaseHistoryJson as ReleaseHistoryEntry[], access),
      generatedAt: new Date().toISOString(),
    });
    const stream = await renderToStream(pdfComponent);
    const chunks: Buffer[] = [];

    for await (const chunk of stream as AsyncIterable<Buffer | Uint8Array | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return new NextResponse(Buffer.concat(chunks), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${buildPdfFilename()}"`,
      },
    });
  } catch (pdfError) {
    console.error('Version history PDF generation error:', pdfError);
    return NextResponse.json({ error: 'Failed to generate version history PDF' }, { status: 500 });
  }
}
