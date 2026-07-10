'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, CheckCircle2, AlertCircle, Eye, EyeOff, KeyRound } from 'lucide-react';
import { validatePasswordStrength, getPasswordRequirements } from '@/lib/utils/password';
import { loadClientAuthSession } from '@/lib/app-auth/client-session';
import { PageLoader } from '@/components/ui/page-loader';

interface AuthSessionResponse {
  authenticated: boolean;
  profile?: {
    full_name?: string | null;
    must_change_password?: boolean | null;
  } | null;
}

export default function ChangePasswordPage() {
  const router = useRouter();

  // State
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [userName, setUserName] = useState('');

  // Check if user is logged in and needs to change password
  useEffect(function () {
    async function checkUser() {
      try {
        const sessionResult = await loadClientAuthSession();
        if (sessionResult.status !== 'authenticated' || !sessionResult.payload) {
          router.replace('/login');
          return;
        }

        const profile = sessionResult.payload.profile as AuthSessionResponse['profile'];

        if (!profile) {
          router.replace('/login');
          return;
        }

        setUserName(profile.full_name || 'User');

        // If they don't need to change password, redirect to dashboard
        if (!profile.must_change_password) {
          router.replace('/dashboard');
          return;
        }

        setLoading(false);
      } catch (error) {
        console.error('Error checking user:', error);
        router.replace('/login');
      }
    }

    void checkUser();
  }, [router]);

  // Handle password change
  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    // Validate passwords
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('Please fill in all fields');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    // Validate password strength
    const validation = validatePasswordStrength(newPassword);
    if (!validation.valid) {
      setError(validation.errors[0]);
      return;
    }

    try {
      setSubmitting(true);

      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          currentPassword,
          password: newPassword,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || 'Failed to change password');
      }

      setSuccess(true);

      // Redirect to dashboard after 2 seconds
      setTimeout(() => {
        router.push('/dashboard');
      }, 2000);
    } catch (error) {
      console.error('Error changing password:', error);
      setError(error instanceof Error ? error.message : 'Failed to change password');
    } finally {
      setSubmitting(false);
    }
  }

  // Password strength indicator
  function getPasswordStrength(password: string): { strength: string; color: string } {
    if (!password) return { strength: '', color: '' };

    const validation = validatePasswordStrength(password);
    if (validation.valid) {
      return { strength: 'Strong', color: 'text-green-500' };
    }

    if (password.length >= 8 && (/[A-Z]/.test(password) || /[a-z]/.test(password) || /[0-9]/.test(password))) {
      return { strength: 'Medium', color: 'text-amber-500' };
    }

    return { strength: 'Weak', color: 'text-red-500' };
  }

  const passwordStrength = getPasswordStrength(newPassword);

  if (loading) {
    return <PageLoader message="Checking password session..." />;
  }

  if (success) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-slate-950 p-4">
        <Card className="w-full max-w-md border-border">
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <div className="rounded-full bg-green-500/10 p-3">
                  <CheckCircle2 className="h-12 w-12 text-green-500" />
                </div>
              </div>
              <h2 className="text-2xl font-bold text-white">Password Changed Successfully!</h2>
              <p className="text-muted-foreground">Redirecting you to the dashboard...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-slate-950 p-4">
      <Card className="w-full max-w-md border-border">
        <CardHeader className="text-center space-y-2">
          <div className="flex justify-center mb-2">
            <div className="rounded-full bg-amber-500/10 p-3">
              <KeyRound className="h-8 w-8 text-amber-500" />
            </div>
          </div>
          <CardTitle className="text-2xl text-white">Change Your Password</CardTitle>
          <CardDescription className="text-muted-foreground">
            Welcome, <strong className="text-white">{userName}</strong>! For security reasons, you must change your temporary password before continuing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePasswordChange} className="space-y-4">
            {error && (
              <div className="bg-red-500/10 border border-red-500/50 rounded p-3 text-sm text-red-400 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Password Requirements */}
            <div className="bg-blue-500/10 border border-blue-500/50 rounded p-3 space-y-2">
              <p className="text-sm font-medium text-blue-400">Password Requirements:</p>
              <ul className="text-xs text-blue-400 space-y-1">
                {getPasswordRequirements().map((req, index) => (
                  <li key={index} className="flex items-center gap-2">
                    <span className="text-blue-500">•</span>
                    {req}
                  </li>
                ))}
              </ul>
            </div>

            {/* Current Password */}
            <div className="space-y-2">
              <Label htmlFor="current-password" className="text-white">
                Current Password *
              </Label>
              <div className="relative">
                <Input
                  id="current-password"
                  type={showCurrentPassword ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter your current password"
                  autoComplete="current-password"
                  className="bg-input border-border text-white pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300"
                >
                  {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                This is required because password changes now need your existing password for verification.
              </p>
            </div>

            {/* New Password */}
            <div className="space-y-2">
              <Label htmlFor="new-password" className="text-white">
                New Password *
              </Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter your new password"
                  autoComplete="new-password"
                  className="bg-input border-border text-white pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300"
                >
                  {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {newPassword && passwordStrength.strength && (
                <p className={`text-xs ${passwordStrength.color}`}>
                  Password strength: {passwordStrength.strength}
                </p>
              )}
            </div>

            {/* Confirm Password */}
            <div className="space-y-2">
              <Label htmlFor="confirm-password" className="text-white">
                Confirm Password *
              </Label>
              <div className="relative">
                <Input
                  id="confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm your new password"
                  autoComplete="new-password"
                  className="bg-input border-border text-white pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300"
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {confirmPassword && newPassword && (
                <p className={`text-xs ${confirmPassword === newPassword ? 'text-green-500' : 'text-red-500'}`}>
                  {confirmPassword === newPassword ? '✓ Passwords match' : '✗ Passwords do not match'}
                </p>
              )}
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              disabled={submitting}
              className="w-full bg-[#F1D64A] text-slate-950 hover:bg-[#F1D64A]/90 font-semibold"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Changing Password...
                </>
              ) : (
                <>
                  <KeyRound className="h-4 w-4 mr-2" />
                  Change Password
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

