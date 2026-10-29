import Image from 'next/image';

/** Centred login lockup; compact navigation retains the original leaf mark. */
export function BrandLogo({ compact = false, priority = false }: { compact?: boolean; priority?: boolean }) {
  return <Image src={compact ? '/branding/leaf-on-light.svg' : '/branding/logo-centered-dark.webp'}
    alt="Forest Farm Tree Services" width={compact ? 30 : 300} height={compact ? 30 : 180}
    className={compact ? 'shrink-0' : 'h-auto max-w-full'} unoptimized priority={priority} />;
}
