'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Camera, Expand } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { InspectionPhoto } from '@/types/inspection';

interface InspectionPhotoGalleryProps {
  photos: InspectionPhoto[];
  title?: string;
  description?: string;
  maxPreview?: number;
  compact?: boolean;
  className?: string;
}

export function InspectionPhotoGallery({
  photos,
  title = 'Defect Photos',
  description = 'Uploaded evidence for this defect.',
  maxPreview = 4,
  compact = false,
  className,
}: InspectionPhotoGalleryProps) {
  const [selectedPhoto, setSelectedPhoto] = useState<InspectionPhoto | null>(null);
  const previewPhotos = useMemo(() => photos.slice(0, maxPreview), [maxPreview, photos]);

  if (photos.length === 0) {
    return null;
  }

  return (
    <>
      <div className={cn('space-y-3', className)}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-medium text-white">{title}</p>
          </div>
          <Badge variant="outline" className="text-xs">
            {photos.length} {photos.length === 1 ? 'photo' : 'photos'}
          </Badge>
        </div>

        <div
          className={cn(
            'grid gap-2',
            compact ? 'grid-cols-3 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3'
          )}
        >
          {previewPhotos.map((photo, index) => {
            const isOverflowTile = index === maxPreview - 1 && photos.length > maxPreview;

            return (
              <button
                key={photo.id}
                type="button"
                onClick={() => setSelectedPhoto(photo)}
                className="group relative overflow-hidden rounded-lg border border-border bg-slate-900/40 text-left"
              >
                <Image
                  src={photo.photo_url}
                  alt={photo.caption || 'Inspection photo'}
                  width={640}
                  height={400}
                  unoptimized
                  loader={({ src }) => src}
                  className={cn(
                    'w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]',
                    compact ? 'h-24' : 'h-32'
                  )}
                />
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/80 via-black/35 to-transparent p-2">
                  <span className="truncate text-xs text-white">
                    {photo.caption || 'Tap to view'}
                  </span>
                  <Expand className="h-3.5 w-3.5 shrink-0 text-white/80" />
                </div>
                {isOverflowTile && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-sm font-semibold text-white">
                    +{photos.length - maxPreview + 1} more
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <Dialog open={Boolean(selectedPhoto)} onOpenChange={(open) => !open && setSelectedPhoto(null)}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-4xl overflow-y-auto border-border">
          {selectedPhoto && (
            <>
              <DialogHeader>
                <DialogTitle>{title}</DialogTitle>
                <DialogDescription>
                  {selectedPhoto.caption || description}
                </DialogDescription>
              </DialogHeader>
              <div className="overflow-hidden rounded-lg border border-border bg-slate-950">
                <Image
                  src={selectedPhoto.photo_url}
                  alt={selectedPhoto.caption || 'Inspection photo'}
                  width={1600}
                  height={1200}
                  unoptimized
                  loader={({ src }) => src}
                  className="max-h-[75vh] w-full object-contain"
                />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
