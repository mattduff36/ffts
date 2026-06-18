'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { AnimatePresence, motion } from 'motion/react';
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
import { DemoBranchNotice } from '@/components/demo/DemoBranchNotice';
import {
  ArrowRight,
  ArrowUpRight,
  Briefcase,
  HardHat,
  MousePointerClick,
  User,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { getDemoPersonas, templateConfig, type DemoPersona } from '@/lib/config/template-config';
import { cn } from '@/lib/utils';

const demoIconByRole: Record<DemoPersona['key'], typeof User> = {
  admin: UserCog,
  manager: Briefcase,
  employee: User,
  contractor: HardHat,
};

interface DemoPersonaStyle {
  roleNote: string;
  accentClassName: string;
  iconClassName: string;
  textClassName: string;
}

const demoPersonaStyles: Record<DemoPersona['key'], DemoPersonaStyle> = {
  admin: {
    roleNote: 'Full access',
    accentClassName: 'bg-red-400',
    iconClassName: 'border-red-400/30 bg-red-400/10 text-red-300',
    textClassName: 'text-red-200',
  },
  manager: {
    roleNote: 'Approvals',
    accentClassName: 'bg-amber-300',
    iconClassName: 'border-amber-300/30 bg-amber-300/10 text-amber-200',
    textClassName: 'text-amber-100',
  },
  employee: {
    roleNote: 'Field work',
    accentClassName: 'bg-blue-400',
    iconClassName: 'border-blue-400/30 bg-blue-400/10 text-blue-200',
    textClassName: 'text-blue-100',
  },
  contractor: {
    roleNote: 'Limited access',
    accentClassName: 'bg-orange-400',
    iconClassName: 'border-orange-400/30 bg-orange-400/10 text-orange-200',
    textClassName: 'text-orange-100',
  },
};

export default function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [personaDrawerOpen, setPersonaDrawerOpen] = useState(false);
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
    <div className="min-h-screen flex items-start justify-center p-4 pb-24 pt-12 sm:pt-16 md:pt-24 relative overflow-hidden bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950">
      {/* Subtle background pattern */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(241,214,74,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(241,214,74,0.03)_1px,transparent_1px)] bg-[size:64px_64px]" />

      <div className="w-full max-w-md relative z-10">
        {/* Brand Logo */}
        <div className="flex justify-center mb-6">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-brand-yellow p-3 shadow-lg shadow-brand-yellow/20">
            <Image
              src={templateConfig.branding.logoPath}
              alt={`${templateConfig.branding.companyName} logo`}
              width={56}
              height={56}
              unoptimized
              className="max-h-full max-w-full object-contain"
            />
          </div>
        </div>

        {/* Title */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">
            {templateConfig.branding.shortAppName.toUpperCase()}
          </h1>
          {templateConfig.isDemoMode && (
            <>
              <p className="text-sm text-muted-foreground">
                Demonstration environment with fictional data only
              </p>
              <DemoBranchNotice compact className="mx-auto mt-4 max-w-sm" />
              <motion.button
                type="button"
                onClick={() => setPersonaDrawerOpen(true)}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.35, duration: 0.4 }}
                className="mt-4 inline-flex max-w-sm items-center justify-center gap-3 rounded-full border border-brand-yellow/40 bg-brand-yellow/10 px-5 py-2.5 text-center text-sm font-medium text-brand-yellow shadow-lg shadow-brand-yellow/10 transition-colors hover:border-brand-yellow/70 hover:bg-brand-yellow/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-yellow/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
              >
                <motion.span
                  className="shrink-0"
                  animate={{ scale: [1, 1.25, 1] }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                  aria-hidden="true"
                >
                  <MousePointerClick className="h-5 w-5" />
                </motion.span>
                <span>
                  Trying the demo? Click the glowing button in the top-right corner to sign in
                  instantly as a demo persona.
                </span>
                <motion.span
                  className="shrink-0"
                  animate={{ x: [0, 4, 0], y: [0, -4, 0] }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                  aria-hidden="true"
                >
                  <ArrowUpRight className="h-5 w-5" />
                </motion.span>
              </motion.button>
            </>
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

      </div>

      {templateConfig.isDemoMode && (
        <>
          {/* Floating circular demo access trigger */}
          <motion.button
            type="button"
            aria-label="Open demo accounts"
            title="Demo accounts"
            onClick={() => setPersonaDrawerOpen(true)}
            initial={{ opacity: 0, scale: 0.6, y: -12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 22, delay: 0.25 }}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.94 }}
            className="group fixed right-4 top-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-brand-yellow text-slate-900 shadow-lg shadow-brand-yellow/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-yellow/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 sm:right-6 sm:top-6 sm:h-16 sm:w-16"
          >
            <span className="absolute inset-0 rounded-full bg-brand-yellow/40 animate-ping [animation-duration:2.5s]" aria-hidden="true" />
            <span className="absolute inset-0 rounded-full bg-brand-yellow" aria-hidden="true" />
            <motion.span
              className="relative flex items-center justify-center"
              animate={{ rotate: [0, -12, 10, -8, 6, -3, 0], x: [0, -1.5, 1.5, -1, 1, 0, 0] }}
              transition={{ duration: 0.7, repeat: Infinity, repeatDelay: 3.5, ease: 'easeInOut', delay: 1.2 }}
              aria-hidden="true"
            >
              <Users className="h-6 w-6 sm:h-7 sm:w-7" strokeWidth={2.25} />
            </motion.span>
            <span className="pointer-events-none absolute -bottom-7 right-0 whitespace-nowrap rounded-md bg-slate-900/90 px-2 py-1 text-[11px] font-semibold text-slate-200 opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100">
              Demo accounts
            </span>
          </motion.button>

          {/* Floating demo personas drawer */}
          <DialogPrimitive.Root open={personaDrawerOpen} onOpenChange={setPersonaDrawerOpen}>
            <AnimatePresence>
              {personaDrawerOpen && (
                <DialogPrimitive.Portal forceMount>
                  <DialogPrimitive.Overlay asChild forceMount>
                    <motion.div
                      className="fixed inset-0 z-[200] bg-slate-950/60 backdrop-blur-sm"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                    />
                  </DialogPrimitive.Overlay>
                  <DialogPrimitive.Content asChild forceMount>
                    <motion.div
                      className="fixed right-0 top-0 z-[201] flex h-dvh w-full max-w-md flex-col border-l border-border/60 bg-slate-900/95 shadow-2xl shadow-slate-950/60 backdrop-blur-xl outline-none sm:right-3 sm:top-3 sm:h-[calc(100dvh-1.5rem)] sm:rounded-2xl sm:border"
                      initial={{ x: '110%' }}
                      animate={{ x: 0 }}
                      exit={{ x: '110%' }}
                      transition={{ type: 'spring', stiffness: 300, damping: 32 }}
                    >
                      <div className="relative overflow-hidden border-b border-border/50 p-6 sm:rounded-t-2xl">
                        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-yellow/70 to-transparent" aria-hidden="true" />
                        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-brand-yellow">
                          Demo access
                        </p>
                        <DialogPrimitive.Title className="mt-2 text-xl font-semibold text-white">
                          Demo Personas
                        </DialogPrimitive.Title>
                        <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                          Choose a role to explore the product with resettable dummy data.
                        </DialogPrimitive.Description>
                        <DialogPrimitive.Close asChild>
                          <button
                            type="button"
                            aria-label="Close demo accounts"
                            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-background/40 text-slate-300 transition-colors hover:bg-background/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-yellow/50"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </DialogPrimitive.Close>
                      </div>

                      <div className="flex-1 space-y-3 overflow-y-auto p-6">
                        {error && (
                          <div className="rounded-lg border border-red-700/50 bg-red-900/30 p-3 text-sm text-red-300">
                            {error}
                          </div>
                        )}
                        {demoPersonas.map((persona, index) => {
                          const Icon = demoIconByRole[persona.key];
                          const style = demoPersonaStyles[persona.key];

                          return (
                            <motion.div
                              key={persona.key}
                              initial={{ opacity: 0, x: 32 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: 0.12 + index * 0.06, type: 'spring', stiffness: 380, damping: 30 }}
                            >
                              <Button
                                type="button"
                                variant="outline"
                                className="group relative h-auto min-h-[88px] w-full overflow-hidden rounded-xl border-border/60 bg-background/45 px-4 py-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-yellow/35 hover:bg-background/70 hover:text-white hover:shadow-lg hover:shadow-slate-950/30 focus-visible:ring-2 focus-visible:ring-brand-yellow/50 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                                onClick={() => handleDemoLogin(persona)}
                                disabled={loading}
                              >
                                <span className={cn('absolute inset-y-0 left-0 w-1', style.accentClassName)} />
                                <span
                                  className={cn(
                                    'ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border',
                                    style.iconClassName
                                  )}
                                >
                                  <Icon className="h-5 w-5" />
                                </span>
                                <span className="flex min-w-0 flex-1 flex-col overflow-hidden">
                                  <span className="flex items-baseline justify-between gap-3">
                                    <span className="min-w-0 font-semibold text-white">{persona.label}</span>
                                    <span className={cn('shrink-0 text-[11px] font-medium uppercase tracking-[0.14em]', style.textClassName)}>
                                      {style.roleNote}
                                    </span>
                                  </span>
                                  <span className="mt-1 block text-xs font-medium leading-5 text-slate-200">
                                    {persona.name}
                                  </span>
                                  <span className="block max-w-full whitespace-normal break-words text-xs leading-5 text-slate-400 group-hover:text-slate-300">
                                    {persona.description}
                                  </span>
                                </span>
                              </Button>
                            </motion.div>
                          );
                        })}
                      </div>

                      <motion.div
                        className="border-t border-border/50 p-6 text-center sm:rounded-b-2xl"
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.4 }}
                      >
                        <Link
                          href="/questionnaire"
                          className="inline-flex items-center justify-center gap-2 rounded-lg border border-brand-yellow/30 bg-brand-yellow/10 px-4 py-3 text-sm font-semibold text-brand-yellow transition-colors hover:border-brand-yellow/60 hover:bg-brand-yellow/15 hover:text-brand-yellow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-yellow/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                        >
                          Request a more personal demo site by answering the Questionnaire
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </motion.div>
                    </motion.div>
                  </DialogPrimitive.Content>
                </DialogPrimitive.Portal>
              )}
            </AnimatePresence>
          </DialogPrimitive.Root>

          {/* Floating questionnaire footer */}
          <motion.footer
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45, duration: 0.4 }}
            className="fixed inset-x-0 bottom-0 z-40 border-t border-border/50 bg-slate-950/80 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]"
          >
            <div className="mx-auto flex w-full max-w-3xl items-center justify-center px-4 py-3">
              <Link
                href="/questionnaire"
                className="inline-flex w-full max-w-xl items-center justify-center gap-2 rounded-lg border border-brand-yellow/30 bg-brand-yellow/10 px-4 py-2.5 text-center text-xs font-semibold text-brand-yellow transition-colors hover:border-brand-yellow/60 hover:bg-brand-yellow/15 hover:text-brand-yellow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-yellow/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 sm:text-sm"
              >
                <span>Request a more personal demo site by answering the Questionnaire</span>
                <ArrowRight className="h-4 w-4 shrink-0" />
              </Link>
            </div>
          </motion.footer>
        </>
      )}
    </div>
  );
}

