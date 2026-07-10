import type { Viewport } from "next";
import { Inter } from "next/font/google";
import { AppProviders } from "@/lib/providers/app-providers";
import { templateConfig } from "@/lib/config/template-config";
import "./globals.css";

// Force dynamic rendering to prevent build-time static generation errors
export const dynamic = 'force-dynamic';

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const appIcon = templateConfig.branding.logoPath;
const appTitle = templateConfig.branding.appName;
const appDescription = `${templateConfig.branding.companyName} digital field operations system`;
const appleTouchIcon = "/apple-touch-icon.png";
const appleTouchIcon180 = "/apple-touch-icon-180x180.png";
const appleTouchIcon152 = "/apple-touch-icon-152x152.png";
const appleTouchIcon167 = "/apple-touch-icon-167x167.png";
const appleTouchIcon120 = "/apple-touch-icon-120x120.png";
const appleTouchIconPrecomposed = "/apple-touch-icon-precomposed.png";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0f172a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const shouldLoadAnalytics = process.env.NODE_ENV === 'production' && process.env.VERCEL === '1';

  return (
    <html
      lang="en"
      className="dark"
      suppressHydrationWarning
      data-scroll-behavior="smooth"
      style={{ colorScheme: 'dark' }}
    >
      <head>
        <title>{appTitle}</title>
        <meta name="description" content={appDescription} />
        <meta name="color-scheme" content="dark" />
        <meta name="application-name" content={templateConfig.branding.shortAppName} />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content={templateConfig.branding.shortAppName} />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" href={templateConfig.branding.faviconPath} type="image/svg+xml" />
        <link rel="icon" href={appIcon} type="image/svg+xml" />
        <link rel="apple-touch-icon" href={appleTouchIcon} sizes="180x180" type="image/png" />
        <link rel="apple-touch-icon" href={appleTouchIcon180} sizes="180x180" type="image/png" />
        <link rel="apple-touch-icon" href={appleTouchIcon152} sizes="152x152" type="image/png" />
        <link rel="apple-touch-icon" href={appleTouchIcon167} sizes="167x167" type="image/png" />
        <link rel="apple-touch-icon" href={appleTouchIcon120} sizes="120x120" type="image/png" />
        <link rel="apple-touch-icon-precomposed" href={appleTouchIconPrecomposed} sizes="180x180" type="image/png" />
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        <AppProviders shouldLoadAnalytics={shouldLoadAnalytics}>{children}</AppProviders>
      </body>
    </html>
  );
}
