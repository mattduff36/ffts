import type { NextConfig } from "next";
import withBundleAnalyzer from "@next/bundle-analyzer";
import releaseVersionState from "./lib/config/release-version.json";
import { formatReleaseVersion } from "./lib/config/release-version-logic";

const bundleAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const supabaseImageRemotePatterns: NonNullable<NextConfig["images"]>["remotePatterns"] = [];
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

if (supabaseUrl) {
  try {
    const parsedSupabaseUrl = new URL(supabaseUrl);
    supabaseImageRemotePatterns.push({
      protocol: parsedSupabaseUrl.protocol.replace(":", "") as "http" | "https",
      hostname: parsedSupabaseUrl.hostname,
      port: parsedSupabaseUrl.port,
      pathname: "/**",
    });
  } catch {
    // Ignore invalid env values so local config still loads.
  }
}

const publicReleaseVersion = formatReleaseVersion(releaseVersionState);

const nextConfig: NextConfig = {
  /* config options here */
  env: {
    NEXT_PUBLIC_APP_RELEASE_VERSION: publicReleaseVersion,
  },
  reactStrictMode: true,
  images: {
    remotePatterns: supabaseImageRemotePatterns,
  },
  // Externalize packages that have been unreliable in bundled server chunks on Windows.
  serverExternalPackages: ['exceljs', 'nuqs'],
  eslint: {
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    
    // Keep local/dev builds fast while still avoiding noisy CI cache issues.
    config.cache = process.env.CI ? false : config.cache;
    
    // Suppress non-critical warnings
    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      // Suppress Supabase realtime warnings about Node.js APIs in Edge Runtime
      { module: /node_modules\/@supabase\/realtime-js/ },
      { module: /node_modules\/@supabase\/supabase-js/ },
      // Suppress the big string serialization warning (cosmetic only)
      /Serializing big strings/,
    ];
    
    return config;
  },
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  // Skip trailing slash redirect for root page
  skipTrailingSlashRedirect: true,
};

export default bundleAnalyzer(nextConfig);
