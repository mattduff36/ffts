'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { useAuth } from '@/lib/hooks/useAuth';
import {
  getOrCreateWebAuthnDeviceId,
  getWebAuthnDeviceLabel,
} from '@/lib/webauthn/device';
import {
  canUsePlatformAuthenticator,
  clearLocalBiometricLoginProfile,
  getLocalBiometricLoginProfileIds,
  hasLocalBiometricLoginProfile,
  startBiometricAuthentication,
} from '@/lib/webauthn/client';
import { clearRetiredAccountSwitchClientState } from '@/lib/app-auth/client';
import { templateConfig } from '@/lib/config/template-config';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Fingerprint, Lock, Monitor } from 'lucide-react';

interface WebAuthnOptionsResponse {
  challenge?: string;
  error?: string;
  [key: string]: unknown;
}

interface AuthResponsePayload {
  profile?: { must_change_password?: boolean | null };
  error?: string;
}

function isSafeRedirectTarget(value: string | null): value is string {
  return Boolean(value && value.startsWith('/'));
}

export default function LoginPage() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);

  useEffect(() => {
    const savedPreference = localStorage.getItem('rememberMe');
    if (savedPreference !== null) {
      setRememberMe(savedPreference === 'true');
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    void canUsePlatformAuthenticator()
      .then((isAvailable) => {
        if (mounted) setBiometricAvailable(isAvailable && hasLocalBiometricLoginProfile());
      })
      .catch(() => {
        if (mounted) setBiometricAvailable(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  function getPostLoginRedirect(payload?: AuthResponsePayload | null): string {
    if (payload?.profile?.must_change_password === true) return '/change-password';

    const redirectTarget =
      typeof window === 'undefined'
        ? null
        : new URL(window.location.href).searchParams.get('redirect');
    if (isSafeRedirectTarget(redirectTarget)) return redirectTarget;

    return '/dashboard';
  }

  async function getWebAuthnOptions(endpoint: string, body?: Record<string, unknown>) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = (await response.json()) as WebAuthnOptionsResponse;
    if (!response.ok || !payload.challenge) {
      throw new Error(payload.error || 'Unable to start biometric authentication');
    }
    return payload;
  }

  function redirectAfterAuth(target: string): void {
    router.replace(target);
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const deviceId = getOrCreateWebAuthnDeviceId();
      const { data, error } = await signIn(email, password, {
        rememberMe,
        deviceId,
        deviceLabel: getWebAuthnDeviceLabel(),
        deferRedirect: true,
      });

      if (error) {
        setError(error.message);
        return;
      }

      clearRetiredAccountSwitchClientState();

      localStorage.setItem('rememberMe', rememberMe ? 'true' : 'false');
      redirectAfterAuth(getPostLoginRedirect(data));
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  async function handleBiometricLogin(): Promise<void> {
    const localProfileId = getLocalBiometricLoginProfileIds()[0] || null;
    if (!localProfileId) {
      setError('Sign in with your password first to enable biometric login on this device.');
      setBiometricAvailable(false);
      return;
    }

    const deviceId = getOrCreateWebAuthnDeviceId();
    setError('');
    setLoading(true);
    try {
      const options = (await getWebAuthnOptions(
        '/api/auth/webauthn/login/options',
        {
          profileId: localProfileId,
          deviceId,
        }
      )) as PublicKeyCredentialRequestOptionsJSON & WebAuthnOptionsResponse;
      const authenticationResponse = await startBiometricAuthentication(options);
      const verifyResponse = await fetch('/api/auth/webauthn/login/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          response: authenticationResponse,
          challenge: options.challenge,
          rememberMe,
          deviceId,
          deviceLabel: getWebAuthnDeviceLabel(),
          profileId: localProfileId,
        }),
      });
      const payload = (await verifyResponse.json().catch(() => ({}))) as AuthResponsePayload;
      if (!verifyResponse.ok) {
        throw new Error(payload.error || 'Biometric login failed');
      }

      clearRetiredAccountSwitchClientState();
      localStorage.setItem('rememberMe', rememberMe ? 'true' : 'false');
      redirectAfterAuth(getPostLoginRedirect(payload));
    } catch (loginError) {
      const message = loginError instanceof Error ? loginError.message : 'Biometric login failed';
      if (
        message.includes('not recognised') ||
        message.includes('not enabled for this device')
      ) {
        clearLocalBiometricLoginProfile(localProfileId);
        const hasAnotherLocalProfile = hasLocalBiometricLoginProfile();
        setBiometricAvailable(hasAnotherLocalProfile);
        setError('Biometric login is not enabled on this device. Sign in with your password to enable it.');
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-dvh sm:h-auto sm:min-h-dvh flex items-start justify-center px-4 pb-4 pt-0 sm:pt-16 md:pt-24 relative overflow-y-auto overflow-x-hidden bg-slate-950">
      {/* Fixed background starts at the viewport edge so iOS can render it under the native status bar. */}
      <div className="fixed inset-0 z-0 pointer-events-none bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(241,214,74,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(241,214,74,0.03)_1px,transparent_1px)] bg-[size:64px_64px]" />
      </div>

      <div className="w-full max-w-lg relative z-10 translate-y-[clamp(1.5rem,10svh,5rem)] sm:translate-y-0">
        {/* Forest Farm brand icon */}
        <div className="flex justify-center mb-6">
          <div className="bg-brand-yellow rounded-2xl p-5 shadow-lg shadow-brand-yellow/20">
            <Lock className="h-10 w-10 text-slate-900" strokeWidth={2.5} />
          </div>
        </div>

        {/* Title */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">
            {templateConfig.branding.shortAppName}
          </h1>
        </div>

        {/* Glass-morphism Card */}
        <Card className="bg-card/40 backdrop-blur-xl border-border/50 shadow-2xl">
          <CardContent className="login-card-content p-6 sm:p-8">
            <form onSubmit={handleSubmit} className="login-form space-y-5 sm:space-y-6">
              {error && (
                <div className="p-3 text-sm text-red-300 bg-red-900/30 border border-red-700/50 rounded-lg backdrop-blur-sm">
                  {error}
                </div>
              )}
              
              <div className="login-field-group space-y-2.5">
                <Label htmlFor="email" className="login-field-label text-base font-medium text-muted-foreground">
                  Email Address
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                  autoComplete="email"
                  className="login-form-input h-14 bg-input border-border px-4 text-base text-white placeholder:text-muted-foreground focus:border-brand-yellow focus:ring-brand-yellow/20"
                />
              </div>

              <div className="login-field-group space-y-2.5">
                <Label htmlFor="password" className="login-field-label text-base font-medium text-muted-foreground">
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                  autoComplete="current-password"
                  className="login-form-input h-14 bg-input border-border px-4 text-base text-white placeholder:text-muted-foreground focus:border-brand-yellow focus:ring-brand-yellow/20"
                />
              </div>

              <div className="login-remember-row flex items-center space-x-3">
                <input
                  type="checkbox"
                  id="remember"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="login-checkbox h-5 w-5 rounded border-slate-600 bg-slate-700/50 text-brand-yellow focus:ring-brand-yellow focus:ring-offset-slate-800"
                  disabled={loading}
                />
                <Label 
                  htmlFor="remember" 
                  className="login-remember-label cursor-pointer text-base font-normal leading-none text-muted-foreground"
                >
                  Keep me signed in
                </Label>
              </div>

              <Button
                type="submit"
                className="login-submit h-14 w-full bg-brand-yellow text-base font-semibold text-slate-900 shadow-lg shadow-brand-yellow/20 transition-all hover:bg-brand-yellow-hover"
                disabled={loading}
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </Button>

              {biometricAvailable ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 w-full border-slate-600 bg-slate-900/40 text-white hover:bg-slate-800"
                  disabled={loading}
                  onClick={() => void handleBiometricLogin()}
                >
                  <Fingerprint className="mr-2 h-4 w-4" />
                  Use biometrics
                </Button>
              ) : null}
            </form>
          </CardContent>
        </Card>

        <div className="mt-6 text-center text-sm text-muted-foreground">
          <p>Contact your administrator for account access or password resets.</p>
          <p className="mt-2 text-xs">
            This company portal uses essential cookies and usage logs to keep accounts secure, diagnose issues, and improve the service.
          </p>
        </div>
      </div>

      <Link
        href="/displayboard-workshop"
        aria-label="Open Workshop Display Board"
        title="Workshop Display Board"
        className="fixed bottom-6 right-6 z-20 hidden h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/35 shadow-lg shadow-black/20 backdrop-blur-md transition hover:border-workshop/35 hover:bg-workshop/10 hover:text-workshop-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-workshop/60 lg:flex"
      >
        <Monitor className="h-5 w-5" />
      </Link>

    </div>
  );
}

