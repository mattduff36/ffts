'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Camera, Expand, Trash2, Upload, X } from 'lucide-react';

interface PhotoUploadProps {
  inspectionId: string;
  itemNumber: number;
  dayOfWeek?: number | null;
  onClose: () => void;
  onUploadComplete: () => void;
}

interface ExistingPhoto {
  id: string;
  photo_url: string;
  caption: string | null;
}

const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export default function PhotoUpload({
  inspectionId,
  itemNumber,
  dayOfWeek = null,
  onClose,
  onUploadComplete,
}: PhotoUploadProps) {
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [existingPhotos, setExistingPhotos] = useState<ExistingPhoto[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [selectedExistingPhoto, setSelectedExistingPhoto] = useState<ExistingPhoto | null>(null);
  const hasPendingPhoto = Boolean(preview);

  const fetchExistingPhotos = useCallback(async () => {
    try {
      let query = supabase
        .from('inspection_photos')
        .select('*')
        .eq('inspection_id', inspectionId)
        .eq('item_number', itemNumber);

      if (dayOfWeek !== null) {
        query = query.eq('day_of_week', dayOfWeek);
      }

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) throw error;
      setExistingPhotos(data || []);
    } catch (err) {
      console.error('Error fetching photos:', err);
    }
  }, [supabase, inspectionId, itemNumber, dayOfWeek]);

  useEffect(() => {
    fetchExistingPhotos();
  }, [fetchExistingPhotos]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError('File size must be less than 5MB');
      return;
    }

    setSelectedFile(file);
    setError('');
    setSuccessMessage('');

    // Create preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const extractErrorMessage = (err: unknown): string => {
    if (err instanceof Error) return err.message;
    if (typeof err === 'object' && err !== null) {
      const obj = err as Record<string, unknown>;
      if (typeof obj.message === 'string') return obj.message;
      if (typeof obj.error === 'string') return obj.error;
      if (typeof obj.statusCode === 'number') return `Storage error (${obj.statusCode})`;
    }
    return String(err);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);
    setError('');

    try {
      const fileExt = selectedFile.name.split('.').pop();
      const fileName = `${inspectionId}/${dayOfWeek ?? 'general'}/${itemNumber}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('inspection-photos')
        .upload(fileName, selectedFile);

      if (uploadError) {
        console.error('Storage upload failed:', uploadError.message ?? uploadError);
        setError(`Upload failed: ${extractErrorMessage(uploadError)}`);
        setUploading(false);
        return;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('inspection-photos')
        .getPublicUrl(fileName);

      const { error: dbError } = await supabase
        .from('inspection_photos')
        .insert({
          inspection_id: inspectionId,
          item_number: itemNumber,
          day_of_week: dayOfWeek,
          photo_url: publicUrl,
          caption: caption || null,
        } as never);

      if (dbError) {
        console.error('DB insert failed:', dbError.message ?? dbError);
        setError(`Save failed: ${extractErrorMessage(dbError)}`);
        setUploading(false);
        return;
      }

      setSelectedFile(null);
      setPreview(null);
      setCaption('');
      setSuccessMessage('Photo saved. You can review it below or add another one.');
      
      await fetchExistingPhotos();
      onUploadComplete();
    } catch (err) {
      console.error('Error uploading photo:', extractErrorMessage(err));
      setError(extractErrorMessage(err) || 'Failed to upload photo');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (photoId: string, photoUrl: string) => {
    if (!confirm('Are you sure you want to delete this photo?')) return;

    try {
      // Extract file path from URL
      const urlParts = photoUrl.split('/inspection-photos/');
      const filePath = urlParts[1];

      // Delete from storage
      const { error: storageError } = await supabase.storage
        .from('inspection-photos')
        .remove([filePath]);

      if (storageError) throw storageError;

      // Delete from database
      const { error: dbError } = await supabase
        .from('inspection_photos')
        .delete()
        .eq('id', photoId);

      if (dbError) throw dbError;

      // Refresh photos list
      await fetchExistingPhotos();
    } catch (err) {
      console.error('Error deleting photo:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete photo');
    }
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[680px] border-border">
        <DialogHeader>
          <DialogTitle>
            Photos for Item #{itemNumber}
            {dayOfWeek ? ` - ${dayNames[dayOfWeek - 1]}` : ''}
          </DialogTitle>
          <DialogDescription>
            Upload and review photos for this defect.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md">
              {error}
            </div>
          )}

          {successMessage && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
              {successMessage}
            </div>
          )}

          {/* Existing Photos */}
          {existingPhotos.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label>Saved Photos</Label>
                <span className="text-xs text-muted-foreground">
                  {existingPhotos.length} saved
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {existingPhotos.map((photo) => (
                  <div key={photo.id} className="space-y-2 rounded-lg border border-border p-2">
                    <button
                      type="button"
                      onClick={() => setSelectedExistingPhoto(photo)}
                      className="group relative block w-full overflow-hidden rounded border"
                    >
                      <Image
                        src={photo.photo_url}
                        alt={photo.caption || 'Inspection photo'}
                        width={400}
                        height={128}
                        unoptimized
                        loader={({ src }) => src}
                        className="h-36 w-full object-cover"
                      />
                      <div className="absolute inset-x-0 bottom-0 flex items-center justify-end bg-gradient-to-t from-black/75 to-transparent p-2">
                        <Expand className="h-3.5 w-3.5 text-white/80" />
                      </div>
                    </button>
                    {photo.caption && (
                      <p className="truncate text-xs text-muted-foreground">
                        {photo.caption}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => setSelectedExistingPhoto(photo)}
                      >
                        <Expand className="mr-2 h-3.5 w-3.5" />
                        View
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        className="flex-1"
                        onClick={() => handleDelete(photo.id, photo.photo_url)}
                      >
                        <Trash2 className="mr-2 h-3 w-3" />
                        Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* File Upload */}
          <div className="space-y-3">
            <Label>{hasPendingPhoto ? 'Ready to Save' : 'Add New Photo'}</Label>
            
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
            />

            {preview ? (
              <div className="relative">
                <Image
                  src={preview}
                  alt="Preview"
                  width={800}
                  height={256}
                  unoptimized
                  loader={({ src }) => src}
                  className="w-full h-64 object-contain rounded border bg-gray-50"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute top-2 right-2"
                  onClick={() => {
                    setSelectedFile(null);
                    setPreview(null);
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-56 w-full flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed border-border bg-slate-900/30 hover:bg-secondary/50 transition-colors"
              >
                <Camera className="h-12 w-12 text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">
                  Click to select a photo
                </span>
                <span className="text-xs text-muted-foreground">
                  Saved photos appear above straight away after you press save.
                </span>
              </button>
            )}

            {hasPendingPhoto && (
              <div className="space-y-2">
                <Label htmlFor="caption">Caption (Optional)</Label>
                <Input
                  id="caption"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Describe the issue..."
                />
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          {hasPendingPhoto ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setSelectedFile(null);
                  setPreview(null);
                  setCaption('');
                  setError('');
                }}
                disabled={uploading}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleUpload}
                disabled={uploading || !selectedFile}
                className="bg-emerald-600 text-white hover:bg-emerald-700"
              >
                <Upload className="h-4 w-4 mr-2" />
                {uploading ? 'Saving...' : 'Save Photo'}
              </Button>
            </>
          ) : (
            <Button type="button" variant="outline" onClick={onClose} disabled={uploading}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>

      {selectedExistingPhoto && (
        <Dialog open onOpenChange={(open) => !open && setSelectedExistingPhoto(null)}>
          <DialogContent className="max-w-4xl border-border">
            <DialogHeader>
              <DialogTitle>
                Photo for Item #{itemNumber}
                {dayOfWeek ? ` - ${dayNames[dayOfWeek - 1]}` : ''}
              </DialogTitle>
              <DialogDescription>
                {selectedExistingPhoto.caption || 'Inspection photo'}
              </DialogDescription>
            </DialogHeader>
            <div className="overflow-hidden rounded-lg border border-border bg-slate-950">
              <Image
                src={selectedExistingPhoto.photo_url}
                alt={selectedExistingPhoto.caption || 'Inspection photo'}
                width={1600}
                height={1200}
                unoptimized
                loader={({ src }) => src}
                className="max-h-[75vh] w-full object-contain"
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );
}

