'use client';

import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Camera, Trash2, UserCircle2 } from 'lucide-react';
import type { ProfileIdentityPayload } from '@/types/profile';

interface ProfileIdentityCardProps {
  profile: ProfileIdentityPayload;
  onSelectAvatarFile: (file: File) => void;
  onRemoveAvatar: () => void;
  isAvatarBusy: boolean;
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
}: ProfileIdentityCardProps) {
  const initials = getInitials(profile.full_name);

  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <CardTitle>My Profile</CardTitle>
        <CardDescription>Personal overview, settings, quick links, and support shortcuts.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] lg:items-start">
          <div className="space-y-5">
            <div className="rounded-lg border border-border bg-slate-900/40 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-full border border-border bg-slate-900/30">
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
                      <div className="flex h-full w-full items-center justify-center bg-slate-800 text-2xl font-semibold text-brand-yellow">
                        {initials}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate text-xl font-semibold text-foreground">{profile.full_name}</p>
                    <p className="text-sm text-muted-foreground">
                      {profile.team?.name || 'Unassigned team'} · {profile.role?.display_name || 'No role'}
                    </p>
                    <p className="text-xs text-muted-foreground">Employee ID: {profile.employee_id || 'N/A'}</p>
                  </div>
                </div>

                <div className="flex w-44 shrink-0 flex-col gap-2">
                  <label>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={isAvatarBusy}
                      onChange={(event) => {
                        const selectedFile = event.currentTarget.files?.[0];
                        if (!selectedFile) return;
                        onSelectAvatarFile(selectedFile);
                        event.currentTarget.value = '';
                      }}
                    />
                    <span>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={isAvatarBusy}
                        className="w-full border-border bg-slate-900/40 text-foreground hover:bg-slate-800"
                        asChild
                      >
                        <span>
                          <Camera className="mr-2 h-4 w-4" />
                          {profile.avatar_url ? 'Change Avatar' : 'Add Avatar'}
                        </span>
                      </Button>
                    </span>
                  </label>

                  {profile.avatar_url ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isAvatarBusy}
                      onClick={onRemoveAvatar}
                      className="w-full border-red-500/50 bg-red-500/10 text-red-200 hover:bg-red-500/20 hover:text-red-100"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Remove Avatar
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      disabled
                      className="w-full border-border bg-slate-900/40 text-muted-foreground"
                    >
                      <UserCircle2 className="mr-2 h-4 w-4" />
                      No avatar uploaded
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <div className="rounded-lg border border-border bg-slate-900/40 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Email</p>
              <p className="text-sm text-foreground">{profile.email || 'Not available'}</p>
            </div>
            <div className="rounded-lg border border-border bg-slate-900/40 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Phone</p>
              <p className="text-sm text-foreground">{profile.phone_number || 'Not set'}</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

