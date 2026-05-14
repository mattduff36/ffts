'use client';

import { useState } from 'react';
import { AlertCircle, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { templateConfig } from '@/lib/config/template-config';

interface DemoEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (realEmail: string) => Promise<void> | void;
  demoUserName: string;
  emailContext?: string;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function DemoEmailModal({
  isOpen,
  onClose,
  onSubmit,
  demoUserName,
  emailContext = 'notification',
}: DemoEmailModalProps) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    if (!isValidEmail(email)) {
      setError('Enter a valid email address.');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit(email);
      setEmail('');
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to send email.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleClose() {
    if (isSubmitting) return;
    setEmail('');
    setError('');
    onClose();
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="mb-2 flex items-center gap-3">
            <div className="rounded-full bg-blue-100 p-3 dark:bg-blue-900/30">
              <Mail className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            </div>
            <DialogTitle>Demo Email Override</DialogTitle>
          </div>
          <DialogDescription className="text-base leading-relaxed">
            {demoUserName} uses the fake demo domain{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              @{templateConfig.demoEmailDomain}
            </code>
            . Demo emails are simulated unless you provide a real recipient for this action.
          </DialogDescription>
        </DialogHeader>

        <div className="my-4 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
          <div className="flex gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-500" />
            <p className="text-sm text-amber-900 dark:text-amber-200">
              Enter your email only if you want to receive this {emailContext}. It will not be stored.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="demo-real-email">Your email address</Label>
            <Input
              id="demo-real-email"
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setError('');
              }}
              placeholder="your.email@example.com"
              disabled={isSubmitting}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Sending...' : 'Send this email'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
