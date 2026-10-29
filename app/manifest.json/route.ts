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
    background_color: '#131614',
    theme_color: '#131614',
    icons: [
      { src: '/branding/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/branding/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/branding/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  });
}
