'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { isAccountSwitcherEnabled } from '@/lib/account-switch/feature-flag';
import {
  getAccountSwitchDeviceLabel,
  getOrCreateAccountSwitchDeviceId,
} from '@/lib/account-switch/device';
import { clearLegacyAccountSwitchClientState } from '@/lib/app-auth/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Briefcase, HardHat, Lock, User, UserCog } from 'lucide-react';
import { getDemoPersonas, templateConfig, type DemoPersona } from '@/lib/config/template-config';

const demoIconByRole: Record<DemoPersona['key'], typeof User> = {
  admin: UserCog,
  manager: Briefcase,
  employee: User,
  contractor: HardHat,
};

export default function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const demoPersonas = getDemoPersonas();

  useEffect(() => {
    const savedPreference = localStorage.getItem('rememberMe');
    if (savedPreference !== null) {
      setRememberMe(savedPreference === 'true');
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const accountSwitcherEnabled = isAccountSwitcherEnabled();
      const { error } = await signIn(email, password, {
        rememberMe,
        deviceId: accountSwitcherEnabled ? getOrCreateAccountSwitchDeviceId() : null,
        deviceLabel: accountSwitcherEnabled ? getAccountSwitchDeviceLabel() : null,
      });

      if (error) {
        setError(error.message);
        return;
      }

      clearLegacyAccountSwitchClientState();

      localStorage.setItem('rememberMe', rememberMe ? 'true' : 'false');
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = async (persona: DemoPersona) => {
    setEmail(persona.email);
    setPassword(persona.password);
    setRememberMe(true);
    setError('');
    setLoading(true);

    try {
      const accountSwitcherEnabled = isAccountSwitcherEnabled();
      const { error } = await signIn(persona.email, persona.password, {
        rememberMe: true,
        deviceId: accountSwitcherEnabled ? getOrCreateAccountSwitchDeviceId() : null,
        deviceLabel: accountSwitcherEnabled ? getAccountSwitchDeviceLabel() : null,
      });

      if (error) {
        setError(error.message);
        return;
      }

      clearLegacyAccountSwitchClientState();
      localStorage.setItem('rememberMe', 'true');
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-start justify-center p-4 pt-12 sm:pt-16 md:pt-24 relative overflow-hidden bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950">
      {/* Subtle background pattern */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(241,214,74,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(241,214,74,0.03)_1px,transparent_1px)] bg-[size:64px_64px]" />

      <div className="w-full max-w-md md:max-w-3xl relative z-10">
        {/* Brand Yellow Icon */}
        <div className="flex justify-center mb-6">
          <div className="bg-brand-yellow rounded-2xl p-5 shadow-lg shadow-brand-yellow/20">
            <Lock className="h-10 w-10 text-slate-900" strokeWidth={2.5} />
          </div>
        </div>

        {/* Title */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">
            {templateConfig.branding.shortAppName.toUpperCase()}
          </h1>
          {templateConfig.isDemoMode && (
            <p className="text-sm text-muted-foreground">
              Demonstration environment with fictional data only
            </p>
          )}
        </div>

        {/* Glass-morphism Card */}
        <Card className="bg-card/40 backdrop-blur-xl border-border/50 shadow-2xl">
          <CardContent className="p-8">
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="p-3 text-sm text-red-300 bg-red-900/30 border border-red-700/50 rounded-lg backdrop-blur-sm">
                  {error}
                </div>
              )}
              
              <div className="space-y-2">
                <Label htmlFor="email" className="text-muted-foreground font-medium">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                  autoComplete="email"
                  className="bg-input border-border text-white placeholder:text-muted-foreground focus:border-brand-yellow focus:ring-brand-yellow/20 h-12"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-muted-foreground font-medium">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                  autoComplete="current-password"
                  className="bg-input border-border text-white placeholder:text-muted-foreground focus:border-brand-yellow focus:ring-brand-yellow/20 h-12"
                />
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="remember"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-600 bg-slate-700/50 text-brand-yellow focus:ring-brand-yellow focus:ring-offset-slate-800"
                  disabled={loading}
                />
                <Label 
                  htmlFor="remember" 
                  className="text-sm font-normal cursor-pointer text-muted-foreground"
                >
                  Keep me signed in
                </Label>
              </div>

              <Button
                type="submit"
                className="w-full h-12 bg-brand-yellow hover:bg-brand-yellow-hover text-slate-900 font-semibold text-base shadow-lg shadow-brand-yellow/20 transition-all"
                disabled={loading}
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="mt-6 text-center text-sm text-muted-foreground">
          <p>Contact your administrator for account access or password resets.</p>
        </div>

        {templateConfig.isDemoMode && (
          <Card className="mt-8 bg-card/40 backdrop-blur-xl border-border/50 shadow-2xl">
            <CardContent className="p-6">
              <div className="mb-4 text-center">
                <h2 className="text-lg font-semibold text-white">Demo Personas</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Choose a role to explore the product with resettable dummy data.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {demoPersonas.map((persona) => {
                  const Icon = demoIconByRole[persona.key];

                  return (
                    <Button
                      key={persona.key}
                      type="button"
                      variant="outline"
                      className="h-auto justify-start gap-3 border-border/60 bg-background/50 px-4 py-3 text-left"
                      onClick={() => handleDemoLogin(persona)}
                      disabled={loading}
                    >
                      <Icon className="h-5 w-5 text-brand-yellow" />
                      <span>
                        <span className="block font-semibold">{persona.label}</span>
                        <span className="block text-xs text-muted-foreground">
                          {persona.name} - {persona.description}
                        </span>
                      </span>
                    </Button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

