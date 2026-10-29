import type { Viewport } from "next";
import { Inter } from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { NumericInputBehavior } from "@/components/layout/NumericInputBehavior";
import { AppProviders } from "@/lib/providers/app-providers";
import { templateConfig } from "@/lib/config/template-config";
import "./globals.css";

// Force dynamic rendering to prevent build-time static generation errors
export const dynamic = 'force-dynamic';

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const socialImage = new URL("/branding/social-card.png", templateConfig.branding.publicUrl).toString();
const appTitle = templateConfig.branding.appName;
const appDescription = `${templateConfig.branding.companyName} digital field operations system`;
const appleTouchIcon = "/apple-touch-icon.png?v=ffts-lettered-1";
const appleTouchIcon180 = "/apple-touch-icon-180x180.png?v=ffts-lettered-1";
const appleTouchIcon152 = "/apple-touch-icon-152x152.png?v=ffts-lettered-1";
const appleTouchIcon167 = "/apple-touch-icon-167x167.png?v=ffts-lettered-1";
const appleTouchIcon120 = "/apple-touch-icon-120x120.png?v=ffts-lettered-1";
const appleTouchIconPrecomposed = "/apple-touch-icon-precomposed.png?v=ffts-lettered-1";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#131614",
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
        <link rel="icon" href="/favicon.svg?v=ffts-leaf" type="image/svg+xml" />
        <link rel="icon" href="/favicon.ico?v=ffts-leaf" sizes="16x16 32x32 48x48" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={appTitle} />
        <meta property="og:title" content={appTitle} />
        <meta property="og:description" content={appDescription} />
        <meta property="og:image" content={socialImage} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content="Forest Farm Tree Services" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={appTitle} />
        <meta name="twitter:description" content={appDescription} />
        <meta name="twitter:image" content={socialImage} />
        <link rel="apple-touch-icon" href={appleTouchIcon} sizes="180x180" type="image/png" />
        <link rel="apple-touch-icon" href={appleTouchIcon180} sizes="180x180" type="image/png" />
        <link rel="apple-touch-icon" href={appleTouchIcon152} sizes="152x152" type="image/png" />
        <link rel="apple-touch-icon" href={appleTouchIcon167} sizes="167x167" type="image/png" />
        <link rel="apple-touch-icon" href={appleTouchIcon120} sizes="120x120" type="image/png" />
        <link rel="apple-touch-icon-precomposed" href={appleTouchIconPrecomposed} sizes="180x180" type="image/png" />
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        <NumericInputBehavior />
        <AppProviders shouldLoadAnalytics={shouldLoadAnalytics}>{children}</AppProviders>
        {shouldLoadAnalytics ? <SpeedInsights /> : null}
      </body>
    </html>
  );
}
