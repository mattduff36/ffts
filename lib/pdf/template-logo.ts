import { readFile } from 'fs/promises';
import { extname } from 'path';
import { resolve } from 'path';
import { templateConfig } from '@/lib/config/template-config';

export async function loadTemplateLogoDataUrl(): Promise<string | null> {
  try {
    const logoPath = resolve(process.cwd(), 'public', templateConfig.branding.logoPath.replace(/^\//, ''));
    const logoBuffer = await readFile(logoPath);
    const mimeType = extname(logoPath).toLowerCase() === '.svg' ? 'image/svg+xml' : 'image/png';
    return `data:${mimeType};base64,${logoBuffer.toString('base64')}`;
  } catch {
    return null;
  }
}
