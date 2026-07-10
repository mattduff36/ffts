'use client';

import { type ChangeEvent, useRef, useState } from 'react';
import Image from 'next/image';
import { Camera, ImagePlus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { ProfileIdentityPayload } from '@/types/profile';

interface ProfileIdentityCardProps {
  profile: ProfileIdentityPayload;
  onSelectAvatarFile: (file: File) => void;
  onRemoveAvatar: () => void;
  isAvatarBusy: boolean;
  description?: string;
}

function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts[parts.length - 1].slice(0, 1)}`.toUpperCase();
}

export function ProfileIdentityCard({
  profile,
  onSelectAvatarFile,
  onRemoveAvatar,
  isAvatarBusy,
  description = 'Personal overview, settings, quick links, and support shortcuts.',
}: ProfileIdentityCardProps) {
  const initials = getInitials(profile.full_name);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [isAvatarDialogOpen, setIsAvatarDialogOpen] = useState(false);

  function handleAvatarInputChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.currentTarget.files?.[0];
    if (!selectedFile) return;

    onSelectAvatarFile(selectedFile);
    setIsAvatarDialogOpen(false);
    event.currentTarget.value = '';
  }

  function handleRemoveAvatarClick() {
    onRemoveAvatar();
    setIsAvatarDialogOpen(false);
  }

  return (
    <Card className="border-border">
      <CardHeader className="px-4 !pb-0 pt-4 sm:px-6 sm:!pb-2 sm:pt-6">
        <CardTitle className="text-2xl sm:text-2xl">{profile.full_name}&apos;s Profile</CardTitle>
        <CardDescription className="hidden sm:block">{description}</CardDescription>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-1 sm:px-6 sm:pb-6 sm:pt-0">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] lg:items-start">
          <div className="rounded-none border-0 bg-transparent p-0 sm:rounded-lg sm:border sm:border-border sm:bg-slate-900/40 sm:p-4">
            <div className="grid min-w-0 grid-cols-2 items-center gap-3 sm:flex sm:gap-4">
              <Dialog open={isAvatarDialogOpen} onOpenChange={setIsAvatarDialogOpen}>
                <DialogTrigger asChild>
                  <button
                    type="button"
                    className="relative aspect-square w-full max-w-[7rem] shrink-0 justify-self-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-yellow focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-60 sm:h-24 sm:w-24 sm:max-w-none sm:justify-self-auto"
                    disabled={isAvatarBusy}
                    aria-label="Manage profile avatar"
                  >
                    <span className="relative block h-full w-full overflow-hidden rounded-full border border-border bg-slate-900/30">
                      {profile.avatar_url ? (
                        <Image
                          src={profile.avatar_url}
                          alt={`${profile.full_name} avatar`}
                          fill
                          unoptimized
                          loader={({ src }) => src}
                          className="object-cover"
                        />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center bg-slate-800 text-xl font-semibold text-brand-yellow sm:text-2xl">
                          {initials}
                        </span>
                      )}
                    </span>

                    <span className="absolute -bottom-0.5 -right-0.5 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-slate-950 bg-brand-yellow text-slate-950 shadow-lg transition hover:bg-brand-yellow/90 sm:h-8 sm:w-8">
                      <Camera className="h-4 w-4" />
                    </span>
                  </button>
                </DialogTrigger>

                <DialogContent className="w-[calc(100vw-2rem)] max-w-xs gap-4 border-border p-4 text-white sm:max-w-sm">
                  <DialogHeader>
                    <DialogTitle className="text-2xl sm:text-lg">Avatar image</DialogTitle>
                    <DialogDescription className="text-base sm:text-sm">Add, change, or remove your profile image.</DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-2">
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={isAvatarBusy}
                      onChange={handleAvatarInputChange}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isAvatarBusy}
                      onClick={() => avatarInputRef.current?.click()}
                      className="h-12 w-full border-border bg-slate-900/40 text-base text-foreground hover:bg-slate-800 sm:h-9 sm:text-sm"
                    >
                      <ImagePlus className="h-5 w-5 sm:h-4 sm:w-4" />
                      {profile.avatar_url ? 'Change image' : 'Add image'}
                    </Button>

                    {profile.avatar_url ? (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={isAvatarBusy}
                        onClick={handleRemoveAvatarClick}
                        className="h-12 w-full border-red-500/50 bg-red-500/10 text-base text-red-200 hover:bg-red-500/20 hover:text-red-100 sm:h-9 sm:text-sm"
                      >
                        <Trash2 className="h-5 w-5 sm:h-4 sm:w-4" />
                        Delete image
                      </Button>
                    ) : null}
                  </div>
                </DialogContent>
              </Dialog>

              <div className="min-w-0 justify-self-stretch space-y-1 text-sm font-semibold leading-5 text-foreground sm:flex-1 sm:text-sm sm:leading-5">
                <p className="truncate whitespace-nowrap">
                  {profile.team?.name || 'Unassigned team'} · {profile.role?.display_name || 'No role'}
                </p>
                <p className="truncate whitespace-nowrap">Employee ID: {profile.employee_id || 'N/A'}</p>
                <p className="truncate whitespace-nowrap sm:hidden">Email: {profile.email || 'Not available'}</p>
                <p className="truncate whitespace-nowrap sm:hidden">Phone: {profile.phone_number || 'Not set'}</p>
              </div>
            </div>
          </div>

          <div className="hidden grid-cols-2 gap-2 sm:grid sm:gap-3 lg:grid-cols-1">
            <div className="min-w-0 rounded-lg border border-border bg-slate-900/40 p-2.5 sm:p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground sm:text-xs">Email</p>
              <p className="truncate text-xs text-foreground sm:text-sm">{profile.email || 'Not available'}</p>
            </div>
            <div className="min-w-0 rounded-lg border border-border bg-slate-900/40 p-2.5 sm:p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground sm:text-xs">Phone</p>
              <p className="truncate text-xs text-foreground sm:text-sm">{profile.phone_number || 'Not set'}</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

