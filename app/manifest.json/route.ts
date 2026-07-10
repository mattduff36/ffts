import { templateConfig } from '@/lib/config/template-config';

export const dynamic = 'force-static';

export async function GET(): Promise<Response> {
  return Response.json({
    name: templateConfig.branding.appName,
    short_name: templateConfig.branding.shortAppName,
    description: `${templateConfig.branding.companyName} digital field operations system`,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone'],
    background_color: templateConfig.branding.backgroundColor,
    theme_color: templateConfig.branding.brandColor,
    icons: [
      {
        src: templateConfig.branding.faviconPath,
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: templateConfig.branding.logoPath,
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  });
}
