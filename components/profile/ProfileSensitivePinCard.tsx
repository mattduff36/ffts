'use client';

import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PanelLoader } from '@/components/ui/panel-loader';

interface SensitivePinStatus {
  configured: boolean;
  pin_length: 4 | 6 | null;
  must_reset: boolean;
  locked_until: string | null;
}

export function ProfileSensitivePinCard() {
  const [status, setStatus] = useState<SensitivePinStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/me/sensitive-pin/status', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to load sensitive PIN status');
      }
      setStatus(payload.status);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to load sensitive PIN status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const canSetPin = !status?.configured || status.must_reset;
  const pinInputClassName =
    'h-14 border-slate-500/80 bg-slate-950/70 text-center text-xl tracking-[0.35em] text-foreground shadow-inner shadow-black/20 placeholder:tracking-normal placeholder:text-slate-500 focus-visible:border-brand-yellow focus-visible:ring-brand-yellow/60 sm:h-10 sm:text-sm sm:tracking-normal';

  async function setSensitivePin() {
    if (pin !== confirmPin) {
      toast.error('PINs do not match');
      return;
    }
    if (!/^\d{4}$|^\d{6}$/.test(pin)) {
      toast.error('PIN must be either 4 or 6 digits');
      return;
    }

    setWorking(true);
    try {
      const response = await fetch('/api/me/sensitive-pin/setup/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to set sensitive PIN');
      }

      setPin('');
      setConfirmPin('');
      toast.success('Sensitive PIN set');
      await loadStatus();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to set sensitive PIN');
    } finally {
      setWorking(false);
    }
  }

  return (
    <Card className="relative overflow-hidden border-slate-700/70 bg-slate-950/95 shadow-2xl shadow-black/30">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(241,214,74,0.16),_transparent_36%),linear-gradient(145deg,_rgba(15,23,42,0.1),_rgba(2,6,23,0.85))]" />
      <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-brand-yellow/80 to-transparent" />
      <CardHeader className="relative">
        <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:items-start sm:text-left">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-brand-yellow/35 bg-brand-yellow/15 text-brand-yellow shadow-lg shadow-brand-yellow/10 sm:h-10 sm:w-10 sm:rounded-lg">
            <ShieldCheck className="h-7 w-7 sm:h-5 sm:w-5" />
          </div>
          <div>
            <CardTitle>Sensitive Access PIN</CardTitle>
            <CardDescription className="text-base sm:text-sm">
              Manage the extra PIN used for protected modules such as Quotes and Customers.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="relative space-y-4">
        {loading ? (
          <PanelLoader message="Checking sensitive PIN status..." className="py-6" />
        ) : (
          <div className={canSetPin ? 'space-y-4' : 'grid gap-4 md:grid-cols-2'}>
            <div className="rounded-2xl border border-brand-yellow/35 bg-brand-yellow/10 p-4 shadow-inner shadow-brand-yellow/5 sm:rounded-md sm:border-border sm:bg-slate-900/30 sm:p-3">
              <p className="text-sm uppercase tracking-wide text-muted-foreground sm:text-xs">Status</p>
              <p className="mt-1 text-base font-medium text-foreground sm:text-sm">
                {status?.configured && !status.must_reset
                  ? 'PIN configured'
                  : status?.must_reset
                    ? 'Reset required'
                    : 'No PIN configured'}
              </p>
              {status?.locked_until ? (
                <p className="mt-1 text-sm text-amber-300 sm:text-xs">
                  Temporarily locked until {new Date(status.locked_until).toLocaleString()}.
                </p>
              ) : null}
            </div>

            {canSetPin ? (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2 rounded-2xl border border-slate-700/70 bg-slate-950/45 p-4 sm:space-y-1.5 sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0">
                    <Label htmlFor="sensitive-pin" className="text-base font-semibold sm:text-sm">New PIN</Label>
                    <Input
                      id="sensitive-pin"
                      value={pin}
                      onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                      inputMode="numeric"
                      autoComplete="off"
                      type="password"
                      placeholder="4 or 6 digits"
                      className={pinInputClassName}
                    />
                  </div>
                  <div className="space-y-2 rounded-2xl border border-slate-700/70 bg-slate-950/45 p-4 sm:space-y-1.5 sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0">
                    <Label htmlFor="sensitive-pin-confirm" className="text-base font-semibold sm:text-sm">Confirm PIN</Label>
                    <Input
                      id="sensitive-pin-confirm"
                      value={confirmPin}
                      onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                      inputMode="numeric"
                      autoComplete="off"
                      type="password"
                      placeholder="Repeat PIN"
                      className={pinInputClassName}
                    />
                  </div>
                </div>

                <p className="text-sm text-muted-foreground sm:text-xs">
                  Choose 4 or 6 digits. This PIN cannot be the same as your normal account password.
                  First-time setup is activated immediately. If you forget it later, an admin must reset it before you can set a new one.
                </p>

                <div className="grid gap-2 rounded-2xl border border-slate-700/70 bg-slate-950/45 p-3 sm:flex sm:flex-wrap sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0">
                  <Button
                    type="button"
                    onClick={() => void setSensitivePin()}
                    disabled={working || !pin || !confirmPin}
                    className="h-14 bg-brand-yellow text-base font-semibold text-slate-900 hover:bg-[#d1b82f] disabled:opacity-60 sm:h-9 sm:text-sm"
                  >
                    {working ? <Loader2 className="mr-2 h-5 w-5 animate-spin sm:h-4 sm:w-4" /> : <KeyRound className="mr-2 h-5 w-5 sm:h-4 sm:w-4" />}
                    Set sensitive PIN
                  </Button>
                </div>
              </>
            ) : (
              <div className="rounded-2xl border border-slate-700/70 bg-slate-950/45 p-4 sm:rounded-md sm:p-3">
                <p className="text-base font-medium text-foreground sm:text-sm">Your sensitive PIN is already set.</p>
                <p className="mt-1 text-sm text-muted-foreground sm:text-xs">
                  If you forget it, ask an administrator to reset it.
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
