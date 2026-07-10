import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf-8');
}

describe('messages route storage access', () => {
  it('uses the admin Supabase client for toolbox-talk PDF storage operations', () => {
    const src = read('app/api/messages/route.ts');

    expect(src).toContain("import { createAdminClient } from '@/lib/supabase/admin';");
    expect(src).toContain('const admin = createAdminClient();');
    expect(src).toMatch(/await admin\.storage\s*\.from\('toolbox-talk-pdfs'\)\s*\.upload/);
    expect(src).toContain("await admin.storage.from('toolbox-talk-pdfs').remove([pdfFilePath]);");
    expect(src).toContain('await admin.auth.admin.getUserById(userId);');
    expect(src).toMatch(/await admin\s*\.from\('messages'\)\s*\.insert/);
    expect(src).toMatch(/await admin\s*\.from\('message_recipients'\)\s*\.insert/);
  });
});
