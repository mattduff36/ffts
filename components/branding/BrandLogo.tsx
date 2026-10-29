import Image from 'next/image';

/** Original FFTS artwork, with white lettering for the app's dark surfaces. */
export function BrandLogo({ compact = false, priority = false }: { compact?: boolean; priority?: boolean }) {
  return <Image src={compact ? '/branding/leaf-on-light.svg' : '/branding/logo-dark.svg'}
    alt="Forest Farm Tree Services" width={compact ? 30 : 300} height={compact ? 30 : 88}
    className={compact ? 'shrink-0' : 'h-auto max-w-full'} unoptimized priority={priority} />;
}
