import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { AppProviders } from "@/lib/providers/app-providers";
import { templateConfig } from "@/lib/config/template-config";
import "./globals.css";

// Force dynamic rendering to prevent build-time static generation errors
export const dynamic = 'force-dynamic';

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});
const shouldRenderAnalytics = process.env.VERCEL === '1';

export const metadata: Metadata = {
  title: templateConfig.branding.appName,
  description: `${templateConfig.branding.companyName} digital field operations system`,
  manifest: "/manifest.json",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    shortcut: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: templateConfig.branding.shortAppName,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: templateConfig.branding.brandColor,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="dark"
      suppressHydrationWarning
      data-scroll-behavior="smooth"
      style={{ colorScheme: 'dark' }}
    >
      <head>
        <meta name="color-scheme" content="dark" />
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        <AppProviders>{children}</AppProviders>
        {shouldRenderAnalytics ? <Analytics /> : null}
      </body>
    </html>
  );
}
