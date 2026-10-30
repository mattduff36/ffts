import Image from 'next/image';

/** Approved centred artwork, with a compact size that follows the navbar text scale for the existing navbar. */
export function BrandLogo({ compact = false, priority = false }: { compact?: boolean; priority?: boolean }) {
  return <Image src="/branding/logo-centered-dark.webp"
    alt="Forest Farm Tree Services" width={compact ? 90 : 300} height={compact ? 54 : 180}
    className={compact ? 'h-[3.375rem] w-[5.625rem] shrink-0 object-contain' : 'h-auto max-w-full'} unoptimized priority={priority || compact} />;
}
