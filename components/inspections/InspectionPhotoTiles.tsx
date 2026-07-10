'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Camera, Expand, Plus } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { InspectionPhoto } from '@/types/inspection';

interface InspectionPhotoTilesProps {
  photos: InspectionPhoto[];
  onManage?: () => void;
  title?: string;
  description?: string;
  emptyLabel?: string;
  emptyHint?: string;
  manageLabel?: string;
  className?: string;
  tileSizeClassName?: string;
}

export function InspectionPhotoTiles({
  photos,
  onManage,
  title = 'Defect Photos',
  description = 'Uploaded evidence for this defect.',
  emptyLabel = 'Add / View Photos',
  emptyHint = 'No photos saved yet',
  manageLabel = 'Add / View',
  className,
  tileSizeClassName = 'h-[88px] w-[88px]',
}: InspectionPhotoTilesProps) {
  const [selectedPhoto, setSelectedPhoto] = useState<InspectionPhoto | null>(null);

  if (photos.length === 0) {
    if (!onManage) {
      return null;
    }

    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onManage}
        className={cn('min-h-[88px] w-full flex-col gap-2 border-border text-muted-foreground hover:bg-slate-800', className)}
      >
        <Camera className="h-5 w-5" />
        <span>{emptyLabel}</span>
        <span className="text-xs text-muted-foreground/80">{emptyHint}</span>
      </Button>
    );
  }

  return (
    <>
      <div className={cn('flex flex-wrap gap-2', className)}>
        {photos.map((photo) => (
          <button
            key={photo.id}
            type="button"
            onClick={() => setSelectedPhoto(photo)}
            className={cn(
              'group relative overflow-hidden rounded-lg border border-border bg-slate-900/40',
              tileSizeClassName
            )}
          >
            <Image
              src={photo.photo_url}
              alt={photo.caption || 'Inspection photo'}
              width={256}
              height={256}
              unoptimized
              loader={({ src }) => src}
              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
            />
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-end bg-gradient-to-t from-black/75 to-transparent p-2">
              <Expand className="h-3.5 w-3.5 text-white/80" />
            </div>
          </button>
        ))}

        {onManage && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onManage}
            className={cn(
              'flex flex-col gap-1 border-border text-muted-foreground hover:bg-slate-800',
              tileSizeClassName
            )}
          >
            <Plus className="h-4 w-4" />
            <span className="text-[11px] leading-tight text-center">{manageLabel}</span>
          </Button>
        )}
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
