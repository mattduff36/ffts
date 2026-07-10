'use client';

import Link from 'next/link';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ProfileBiometricsCard } from '@/components/profile/ProfileBiometricsCard';
import { ProfileSensitivePinCard } from '@/components/profile/ProfileSensitivePinCard';
import type { ProfilePermissionSummaryItem } from '@/types/profile';

interface ProfileSecurityTabProps {
  sensitiveModules: ProfilePermissionSummaryItem[];
}

export function ProfileSecurityTab({ sensitiveModules }: ProfileSecurityTabProps) {
  return (
    <div className="space-y-4">
      <Card className="border-slate-700/70 bg-gradient-to-br from-slate-900 via-slate-900 to-brand-yellow/10">
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-brand-yellow/15 p-3 text-brand-yellow sm:p-2">
              <KeyRound className="h-6 w-6 sm:h-5 sm:w-5" />
            </div>
            <div>
              <CardTitle>Password Reset</CardTitle>
              <CardDescription className="text-base sm:text-sm">Change your account password when needed.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            variant="outline"
            className="h-14 w-full border-red-500/50 bg-red-500/80 text-base font-semibold text-white hover:bg-red-500 sm:h-9 sm:w-auto sm:text-sm"
            asChild
          >
            <Link href="/change-password">Change password</Link>
          </Button>
        </CardContent>
      </Card>

      {sensitiveModules.length > 0 ? (
        <ProfileSensitivePinCard />
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-green-500/15 p-3 text-green-300 sm:p-2">
                <ShieldCheck className="h-6 w-6 sm:h-5 sm:w-5" />
              </div>
              <div>
                <CardTitle>Sensitive Access PIN</CardTitle>
                <CardDescription className="text-base sm:text-sm">
                  Your current module access does not require an extra sensitive access PIN.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
        </Card>
      )}

      <ProfileBiometricsCard />
    </div>
  );
}
