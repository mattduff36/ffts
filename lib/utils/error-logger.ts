/**
 * Global Error Logger
 * Captures and stores all application errors for debugging
 * Automatically sends daily error summary email on first error of each day
 */

import { toast } from 'sonner';
import { isClientSessionPausedMessage } from '@/lib/app-auth/session-error';
import { getErrorStatus, isAuthErrorStatus } from '@/lib/utils/http-error';
import { getUsageAnalyticsContext, trackUsageEvent } from '@/lib/analytics/client';

export interface ErrorHandlingMetadata {
  wasHandled: boolean;
  didShowMessage: boolean | null;
  messageChannel?: 'toast' | 'inline' | 'modal' | 'unknown';
  userMessage?: string | null;
  userMessageTitle?: string | null;
  userMessageDescription?: string | null;
  correlationKey?: string | null;
}

export type ErrorClassificationCategory =
  | 'user_error_expected'
  | 'codebase_error'
  | 'connection_error'
  | 'other';

export interface ErrorClassificationMetadata {
  category: ErrorClassificationCategory;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

interface UserActionMetadata {
  actionType: 'click' | 'submit' | 'keyboard' | 'navigation' | 'unknown';
  label: string | null;
  element: string | null;
  href: string | null;
  pageUrl: string;
  timestamp: string;
  ageMs: number;
}

interface ToastErrorMetadata {
  correlationKey: string | null;
  title: string;
  description: string | null;
  combinedMessage: string;
  shownAt: number;
}

export function shouldIgnoreRuntimeErrorForLogging(message: string, filename?: string): boolean {
  const msg = (message || '').trim();
  const file = filename || '';
  const normalized = msg.toLowerCase();

  // Browser reports this generic cross-origin/script failure without useful code context.
  if (msg === 'Script error.' && !file) return true;

  // Minified Next chunk script failures usually indicate a stale/interrupted deploy asset.
  if (msg === 'Script error.' && file.includes('/_next/static/')) return true;
  if (normalized.includes('chunkloaderror')) return true;
  if (normalized.includes('loading chunk') && normalized.includes('failed')) return true;

  // Mobile Safari noise seen in production logs (no repo reference found).
  if (msg.includes("Can't find variable: gmo") || msg.includes('gmo is not defined')) return true;

  // Ignore obvious extension / injected script failures (best-effort, keep narrow).
  if (file.includes('chrome-extension://') || file.includes('safari-extension://')) return true;

  return false;
}

export function shouldIgnoreConsoleErrorForLogging(errorMessage: string): boolean {
  const normalized = errorMessage.toLowerCase();

  if (
    normalized.includes('failed to fetch rsc payload') &&
    normalized.includes('falling back to browser navigation')
  ) {
    return true;
  }

  const hasTransientNetworkMarker = [
    'typeerror: load failed',
    'error: load failed',
    'unknownerrorexception: load failed',
    'failed to fetch',
    'networkerror',
    'network request failed',
  ].some((marker) => normalized.includes(marker));

  if (!hasTransientNetworkMarker) return false;

  return [
    'error signing message:',
    'failed to load pdf document:',
    'error fetching rams documents:',
    'error fetching notifications:',
    'error checking for existing timesheet:',
    'error fetching timesheet type:',
  ].some((context) => normalized.includes(context));
}

function asLoggingText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

function isMessageLessBrowserEvent(reason: unknown): boolean {
  if (!reason || typeof reason !== 'object' || reason instanceof Error) {
    return false;
  }

  const reasonLike = reason as {
    isTrusted?: unknown;
    message?: unknown;
    stack?: unknown;
    target?: unknown;
    currentTarget?: unknown;
    type?: unknown;
  };

  if (asLoggingText(reasonLike.message) || asLoggingText(reasonLike.stack)) {
    return false;
  }

  if (typeof Event !== 'undefined' && reason instanceof Event) {
    return true;
  }

  const hasEventShape =
    'isTrusted' in reasonLike &&
    ('target' in reasonLike || 'currentTarget' in reasonLike || 'type' in reasonLike);

  return reasonLike.isTrusted === true && hasEventShape;
}

export function shouldIgnoreUnhandledPromiseRejectionForLogging(reason: unknown): boolean {
  const reasonLike = reason && typeof reason === 'object' ? reason as { message?: unknown; stack?: unknown } : null;
  const message =
    (reason instanceof Error ? asLoggingText(reason.message) : null) ||
    asLoggingText(reasonLike?.message) ||
    '';
  const stack =
    (reason instanceof Error ? asLoggingText(reason.stack) : null) ||
    asLoggingText(reasonLike?.stack) ||
    '';
  const status = getErrorStatus(reason);

  if (!message) {
    return isMessageLessBrowserEvent(reason);
  }

  if (shouldIgnoreRuntimeErrorForLogging(message, stack)) {
    return true;
  }

  if (message.includes('We could not verify your session, so data loading has been paused.')) {
    return true;
  }

  if (message !== 'Unauthorized' && message !== 'Session is locked') {
    return false;
  }

  if (isAuthErrorStatus(status)) {
    return true;
  }

  return (
    stack.includes('accessToken') ||
    stack.includes('_getAccessToken') ||
    stack.includes('setAuth') ||
    stack.includes('SupabaseClient')
  );
}

export interface ErrorLog {
  id: string;
  timestamp: string;
  error_message: string;
  error_stack: string | null;
  error_type: string;
  user_id: string | null;
  user_email: string | null;
  page_url: string;
  user_agent: string;
  component_name: string | null;
  additional_data: Record<string, unknown> | null;
}

class ErrorLogger {
  private static instance: ErrorLogger;
  private queue: Omit<ErrorLog, 'id'>[] = [];
  private isProcessing = false;
  private isLogging = false; // Prevent recursive logging
  private lastEmailSentDate: string | null = null; // Track last daily email sent
  private latestToastError: ToastErrorMetadata | null = null;
  private latestToastErrorsByKey = new Map<string, ToastErrorMetadata>();
  private latestUserAction: Omit<UserActionMetadata, 'ageMs' | 'timestamp'> & { timestampMs: number } | null = null;

  private asText(value: unknown): string | null {
    return asLoggingText(value);
  }

  private truncate(value: string, maxLength = 140): string {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength - 1)}...`;
  }

  private describeElement(target: EventTarget | null): { label: string | null; element: string | null; href: string | null } {
    if (!(target instanceof Element)) return { label: null, element: null, href: null };

    const rawText = target.textContent?.replace(/\s+/g, ' ').trim() || '';
    const label =
      this.asText(target.getAttribute('data-error-action')) ||
      this.asText(target.getAttribute('aria-label')) ||
      (rawText ? this.truncate(rawText) : null);

    const classes = target.className
      .toString()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .join('.');
    const id = target.id ? `#${target.id}` : '';
    const classSuffix = classes ? `.${classes}` : '';
    const element = `${target.tagName.toLowerCase()}${id}${classSuffix}`;
    const href = target instanceof HTMLAnchorElement ? target.href : null;

    return { label, element, href };
  }

  private recordUserAction(actionType: UserActionMetadata['actionType'], target: EventTarget | null): void {
    const { label, element, href } = this.describeElement(target);
    this.latestUserAction = {
      actionType,
      label,
      element,
      href,
      pageUrl: typeof window !== 'undefined' ? window.location.href : 'N/A',
      timestampMs: Date.now(),
    };
  }

  private getRecentUserAction(maxAgeMs: number): UserActionMetadata | null {
    if (!this.latestUserAction) return null;
    const ageMs = Date.now() - this.latestUserAction.timestampMs;
    if (ageMs > maxAgeMs) return null;

    return {
      actionType: this.latestUserAction.actionType,
      label: this.latestUserAction.label,
      element: this.latestUserAction.element,
      href: this.latestUserAction.href,
      pageUrl: this.latestUserAction.pageUrl,
      timestamp: new Date(this.latestUserAction.timestampMs).toISOString(),
      ageMs,
    };
  }

  private classifyError(
    message: string,
    args: unknown[],
    componentName?: string | null
  ): ErrorClassificationMetadata {
    const normalized = (message || '').toLowerCase();

    const hasAny = (patterns: string[]): boolean => patterns.some((pattern) => normalized.includes(pattern));

    const isConnection = hasAny([
      'failed to fetch',
      'networkerror',
      'network request failed',
      'network error',
      'authretryablefetcherror',
      'load failed',
      'err_internet_disconnected',
      'err_network_changed',
      'timeout',
      'connection',
    ]);
    if (isConnection) {
      return {
        category: 'connection_error',
        confidence: 'high',
        reason: 'Network/connectivity markers found in error message.',
      };
    }

    const serializedArgs = (() => {
      try {
        return JSON.stringify(args).toLowerCase();
      } catch {
        return '';
      }
    })();
    const isExpectedUserError =
      hasAny([
        'validation',
        'required',
        'already exists',
        'duplicate',
        'forbidden',
        'unauthorized',
        'permission denied',
        'cannot coerce the result to a single json object',
      ]) ||
      (normalized.includes('pgrst116') || serializedArgs.includes('pgrst116')) ||
      (normalized.includes('0 rows') || serializedArgs.includes('0 rows'));
    if (isExpectedUserError) {
      return {
        category: 'user_error_expected',
        confidence: 'medium',
        reason: 'Validation/permission/not-found style failure pattern.',
      };
    }

    const isCodebaseError =
      hasAny([
        'typeerror',
        'referenceerror',
        'syntaxerror',
        'cannot read properties',
        'is not a function',
        'undefined is not',
      ]) ||
      componentName === 'Global Error Handler' ||
      componentName === 'Unhandled Promise Rejection' ||
      componentName === 'Error Boundary';
    if (isCodebaseError) {
      return {
        category: 'codebase_error',
        confidence: 'high',
        reason: 'Runtime exception signature indicates application defect.',
      };
    }

    return {
      category: 'other',
      confidence: 'low',
      reason: 'No strong classification signal found.',
    };
  }

  private extractToastContextKey(options?: unknown): string | null {
    if (!options || typeof options !== 'object') return null;
    const candidate = (options as { id?: unknown }).id;
    return this.asText(candidate);
  }

  private extractErrorContextKey(args: unknown[]): string | null {
    for (const arg of args) {
      if (!arg || typeof arg !== 'object' || arg instanceof Error) continue;
      const contextObject = arg as {
        errorContextId?: unknown;
        toastId?: unknown;
        errorToastId?: unknown;
        errorContextKey?: unknown;
      };
      const candidate =
        this.asText(contextObject.errorContextId) ||
        this.asText(contextObject.toastId) ||
        this.asText(contextObject.errorToastId) ||
        this.asText(contextObject.errorContextKey);
      if (candidate) return candidate;
    }
    return null;
  }

  private captureToastErrorMetadata(message: unknown, options?: unknown): void {
    const correlationKey = this.extractToastContextKey(options);
    const title = this.asText(message) || 'Error';
    const description = this.asText((options as { description?: unknown } | undefined)?.description) || null;
    const combinedMessage = description ? `${title} - ${description}` : title;

    const snapshot: ToastErrorMetadata = {
      correlationKey,
      title,
      description,
      combinedMessage,
      shownAt: Date.now(),
    };
    this.latestToastError = snapshot;
    if (correlationKey) {
      this.latestToastErrorsByKey.set(correlationKey, snapshot);
    }
  }

  private consumeRecentToastError(maxAgeMs: number): ToastErrorMetadata | null {
    if (!this.latestToastError) return null;
    if (Date.now() - this.latestToastError.shownAt > maxAgeMs) return null;
    const matched = this.latestToastError;
    this.latestToastError = null;
    return matched;
  }

  private consumeRecentToastErrorByKey(key: string, maxAgeMs: number): ToastErrorMetadata | null {
    const matched = this.latestToastErrorsByKey.get(key);
    if (!matched) return null;
    if (Date.now() - matched.shownAt > maxAgeMs) {
      this.latestToastErrorsByKey.delete(key);
      return null;
    }
    this.latestToastErrorsByKey.delete(key);
    if (this.latestToastError?.correlationKey === key) {
      this.latestToastError = null;
    }
    return matched;
  }

  /**
   * Some errors are caused by browser quirks, extensions, or third-party snippets.
   * We don't want these to pollute centralized logging (especially on mobile Safari).
   */
  private shouldIgnoreRuntimeError(message: string, filename?: string): boolean {
    return shouldIgnoreRuntimeErrorForLogging(message, filename);
  }

  private shouldIgnoreUnhandledPromiseRejection(reason: unknown): boolean {
    return shouldIgnoreUnhandledPromiseRejectionForLogging(reason);
  }

  private constructor() {
    // Load last email sent date from localStorage
    if (typeof window !== 'undefined') {
      this.lastEmailSentDate = localStorage.getItem('lastErrorEmailSentDate');
    }
    // Set up global error handlers
    if (typeof window !== 'undefined') {
      window.addEventListener(
        'click',
        (event) => this.recordUserAction('click', event.target),
        true
      );
      window.addEventListener(
        'submit',
        (event) => this.recordUserAction('submit', event.target),
        true
      );
      window.addEventListener(
        'keydown',
        (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            this.recordUserAction('keyboard', event.target);
          }
        },
        true
      );
      window.addEventListener(
        'popstate',
        () => this.recordUserAction('navigation', null),
        true
      );

      // Capture unhandled errors
      window.addEventListener('error', (event) => {
        const errorMessage = event.error?.message || event.message || 'Unknown error';
        const location = event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : 'unknown location';

        // Filter out known noisy runtime errors before logging
        if (this.shouldIgnoreRuntimeError(errorMessage, event.filename)) {
          return;
        }
        
        this.logError({
          error: event.error || new Error(`Uncaught Error: ${errorMessage} at ${location}`),
          componentName: 'Global Error Handler',
          additionalData: {
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
            location,
            description: `Unhandled JavaScript error thrown at runtime`,
            errorHandling: { wasHandled: false, didShowMessage: false } as ErrorHandlingMetadata,
          },
        });
      });

      // Capture unhandled promise rejections
      window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason;
        if (this.shouldIgnoreUnhandledPromiseRejection(reason)) {
          return;
        }
        let errorMessage = 'Promise rejected';
        
        if (reason instanceof Error) {
          errorMessage = `Unhandled Promise Rejection: ${reason.message}`;
        } else if (typeof reason === 'string') {
          errorMessage = `Unhandled Promise Rejection: ${reason}`;
        } else if (reason && typeof reason === 'object') {
          errorMessage = `Unhandled Promise Rejection: ${JSON.stringify(reason)}`;
        }
        
        this.logError({
          error: reason instanceof Error ? reason : new Error(errorMessage),
          componentName: 'Unhandled Promise Rejection',
          additionalData: {
            reason: reason,
            reasonType: typeof reason,
            description: 'Promise was rejected but no .catch() handler was attached',
            pageUrl: window.location.href,
            errorHandling: { wasHandled: false, didShowMessage: false } as ErrorHandlingMetadata,
          },
        });
      });

      // Capture console.error calls (for development)
      const originalError = console.error;
      console.error = (...args: unknown[]) => {
        originalError.apply(console, args);
        
        // Don't log if we're already in the logging process (prevent recursion)
        if (this.isLogging) return;
        
        // Helper function to serialize an argument properly
        const serializeArg = (arg: unknown): string => {
          if (arg === null) return 'null';
          if (arg === undefined) return 'undefined';
          
          // Handle Error objects specially
          if (arg instanceof Error) {
            return `${arg.name}: ${arg.message}${arg.stack ? '\n' + arg.stack : ''}`;
          }
          
          // Handle plain objects
          if (typeof arg === 'object') {
            try {
              const keys = Object.keys(arg);
              // Empty object
              if (keys.length === 0) return '{}';
              
              // Try to stringify with error properties if it looks like an error
              if ('message' in arg || 'name' in arg || 'stack' in arg) {
                const errorLike = arg as { message?: string; name?: string; stack?: string };
                return `${errorLike.name || 'Error'}: ${errorLike.message || 'Unknown error'}`;
              }
              
              // Regular object - stringify
              const stringified = JSON.stringify(arg, null, 2);
              // If it stringifies to empty object, return a more useful representation
              return stringified === '{}' ? '[Empty Object]' : stringified;
            } catch {
              return '[Object (unstringifiable)]';
            }
          }
          
          return String(arg);
        };
        
        const errorMessage = args.map(serializeArg).join(' ');
        
        // Don't log errors from the error logging system itself
        if (errorMessage.includes('Error fetching error logs') || 
            errorMessage.includes('error_logs') ||
            errorMessage.includes('Failed to log error')) {
          return;
        }

        if (shouldIgnoreConsoleErrorForLogging(errorMessage)) {
          return;
        }

        // Filter out noisy network failures that are common on mobile and not actionable.
        // These should be handled gracefully in-app without escalating to centralized logs.
        if (
          errorMessage.includes('TypeError: Failed to fetch') &&
          (errorMessage.includes('Error fetching profile:') || errorMessage.includes('Error checking for duplicate:'))
        ) {
          return;
        }

        if (isClientSessionPausedMessage(errorMessage)) {
          return;
        }
        
        // Filter out empty/meaningless errors
        if (errorMessage.trim() === '{}' || 
            errorMessage.trim() === '' ||
            errorMessage.trim() === '[Empty Object]' ||
            errorMessage === '[object Object]' ||
            errorMessage === 'undefined' ||
            errorMessage === 'null') {
          return;
        }
        
        // Filter out Supabase auth internal errors (empty objects from auth flow)
        if (args.length === 1 && 
            typeof args[0] === 'object' && 
            args[0] !== null &&
            Object.keys(args[0]).length === 0) {
          return;
        }
        
        // Filter out Supabase session errors (these are internal and not actionable)
        if (errorMessage.includes('_useSession') || 
            errorMessage.includes('_getUser') ||
            errorMessage.includes('AuthSessionMissingError')) {
          return;
        }
        
        // Only log if it looks like an actual error (not React warnings)
        if (!errorMessage.includes('Warning:') && !errorMessage.includes('%c')) {
          // Delay one tick so a toast.error call in the same catch block can be correlated.
          window.setTimeout(() => {
            // Capture navigation context to help diagnose stale-bundle issues
            let navigationEntry: { type?: string; duration?: number } | null = null;
            try {
              const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
              if (nav) navigationEntry = { type: nav.type, duration: Math.round(nav.duration) };
            } catch { /* ignore */ }

            const explicitContextKey = this.extractErrorContextKey(args);
            const toastMessage = explicitContextKey
              ? this.consumeRecentToastErrorByKey(explicitContextKey, 10000)
              : this.consumeRecentToastError(2500);

            this.logError({
              error: new Error(`Console Error: ${errorMessage}`),
              componentName: 'Console Error',
              additionalData: { 
                args,
                description: 'Error logged via console.error() in application code',
                pageUrl: typeof window !== 'undefined' ? window.location.href : 'N/A',
                callStack: new Error().stack,
                // Deployment ID baked into running bundle at build time.
                // If this differs from the latest server deployment, the user is
                // running a stale bundle (old tab, bfcache, etc.).
                bundleDeploymentId: process.env.NEXT_PUBLIC_VERCEL_DEPLOYMENT_ID || 'local',
                // Navigation type: 'navigate' | 'reload' | 'back_forward' | 'prerender'
                // 'back_forward' = Chrome restored page from bfcache
                navigationEntry,
                userMessage: toastMessage ? toastMessage.combinedMessage : null,
                userMessageTitle: toastMessage ? toastMessage.title : null,
                userMessageDescription: toastMessage ? toastMessage.description : null,
                toastCorrelationKey: explicitContextKey || toastMessage?.correlationKey || null,
                errorHandling: {
                  wasHandled: true,
                  didShowMessage: Boolean(toastMessage),
                  messageChannel: toastMessage ? 'toast' : 'unknown',
                  userMessage: toastMessage ? toastMessage.combinedMessage : null,
                  userMessageTitle: toastMessage ? toastMessage.title : null,
                  userMessageDescription: toastMessage ? toastMessage.description : null,
                  correlationKey: explicitContextKey || toastMessage?.correlationKey || null,
                } as ErrorHandlingMetadata,
              },
            });
          }, 0);
        }
      };

      const originalToastError = toast.error.bind(toast);
      toast.error = ((message: unknown, options?: unknown) => {
        this.captureToastErrorMetadata(message, options);
        return originalToastError(
          message as Parameters<typeof toast.error>[0],
          options as Parameters<typeof toast.error>[1]
        );
      }) as typeof toast.error;
    }
  }

  public static getInstance(): ErrorLogger {
    if (typeof window === 'undefined') {
      throw new Error('ErrorLogger can only be instantiated in the browser');
    }
    if (!ErrorLogger.instance) {
      ErrorLogger.instance = new ErrorLogger();
    }
    return ErrorLogger.instance;
  }

  /**
   * Log an error to the database
   */
  public async logError({
    error,
    componentName = null,
    additionalData = null,
  }: {
    error: Error | string;
    componentName?: string | null;
    additionalData?: Record<string, unknown> | null;
  }): Promise<void> {
    // Prevent recursive logging
    if (this.isLogging) return;
    
    this.isLogging = true;
    
    try {
      const errorObj = typeof error === 'string' ? new Error(error) : error;
      const normalizedAdditionalData: Record<string, unknown> = {
        ...additionalData,
      };
      const args = Array.isArray(normalizedAdditionalData.args)
        ? (normalizedAdditionalData.args as unknown[])
        : [];

      if (!normalizedAdditionalData.errorClassification) {
        normalizedAdditionalData.errorClassification = this.classifyError(
          errorObj.message || String(error),
          args,
          componentName
        );
      }

      if (!normalizedAdditionalData.userAction) {
        const recentAction = this.getRecentUserAction(45000);
        if (recentAction) {
          normalizedAdditionalData.userAction = recentAction;
        }
      }

      const usageAnalyticsContext = getUsageAnalyticsContext();
      normalizedAdditionalData.usageAnalytics = usageAnalyticsContext;
      trackUsageEvent({
        eventName: 'error_observed',
        path: typeof window !== 'undefined' ? window.location.href : null,
        metadata: {
          componentName,
          errorType: errorObj.name || 'Error',
          errorMessage: this.truncate(errorObj.message || String(error), 180),
          classification: normalizedAdditionalData.errorClassification,
          clientSessionId: usageAnalyticsContext.clientSessionId,
        },
      });
      
      const errorLog: Omit<ErrorLog, 'id'> = {
        timestamp: new Date().toISOString(),
        error_message: errorObj.message || String(error),
        error_stack: errorObj.stack || null,
        error_type: errorObj.name || 'Error',
        user_id: null,
        user_email: null,
        page_url: typeof window !== 'undefined' ? window.location.href : 'N/A',
        user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : 'N/A',
        component_name: componentName,
        additional_data: Object.keys(normalizedAdditionalData).length > 0 ? normalizedAdditionalData : null,
      };

      // Add to queue
      this.queue.push(errorLog);

      // Process queue
      this.processQueue();
    } catch (err) {
      // Silent fail - don't want error logging to break the app
      // Use console.warn to avoid triggering the console.error interceptor
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('Failed to log error:', err);
      }
    } finally {
      this.isLogging = false;
    }
  }

  /**
   * Process the error queue and save to database
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    try {
      while (this.queue.length > 0) {
        const batch = [...this.queue];
        this.queue = [];

        const response = await fetch('/api/errors/log', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'same-origin',
          keepalive: true,
          body: JSON.stringify({ logs: batch }),
        });

        if (!response.ok) {
          // Put items back in queue if insert failed
          this.queue.unshift(...batch);
          const payload = await response.json().catch(() => ({}));
          console.warn('Failed to save error logs to database:', payload?.error || `HTTP ${response.status}`);
          break;
        }

        // After successfully logging error, check if we should send daily summary
        this.checkAndSendDailySummary();
      }
    } catch (err) {
      console.warn('Error processing error queue:', err);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Check if this is the first error of a new day and send daily summary
   */
  private async checkAndSendDailySummary(): Promise<void> {
    // Only run on client side
    if (typeof window === 'undefined') return;

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

    // Check if we've already sent an email today
    if (this.lastEmailSentDate === today) {
      return; // Already sent today
    }

    // This is the first error of a new day - trigger the daily summary
    try {
      const response = await fetch('/api/errors/daily-summary', {
        method: 'POST',
      });

      if (response.ok) {
        // Update last sent date
        this.lastEmailSentDate = today;
        if (typeof window !== 'undefined') {
          localStorage.setItem('lastErrorEmailSentDate', today);
        }
        console.log('Daily error summary email sent successfully');
      } else {
        console.warn('Failed to send daily error summary email');
      }
    } catch (err) {
      // Silent fail - don't want email sending to break error logging
      console.warn('Error sending daily summary:', err);
    }
  }

  /**
   * Clear all error logs (SuperAdmin only)
   */
  public async clearAllLogs(): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch('/api/debug/error-logs', {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }

      return { success: true };
    } catch (err) {
      return { 
        success: false, 
        error: err instanceof Error ? err.message : 'Unknown error' 
      };
    }
  }
}

type ErrorLoggerArgs = {
  error: Error | string;
  componentName?: string | null;
  additionalData?: Record<string, unknown> | null;
};

type ErrorLoggerFacade = {
  logError: (args: ErrorLoggerArgs) => Promise<void>;
  clearAllLogs: () => Promise<{ success: boolean; error?: string }>;
};

function getBrowserErrorLogger(): ErrorLogger | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return ErrorLogger.getInstance();
}

export function initializeErrorLogger(): void {
  void getBrowserErrorLogger();
}

// Export a server-safe facade so accidental SSR imports do not instantiate the browser client.
export const errorLogger: ErrorLoggerFacade = {
  async logError(args) {
    const logger = getBrowserErrorLogger();
    if (!logger) return;
    await logger.logError(args);
  },
  async clearAllLogs() {
    const logger = getBrowserErrorLogger();
    if (!logger) {
      return { success: false, error: 'Error logger is only available in the browser' };
    }
    return logger.clearAllLogs();
  },
};

/**
 * React Error Boundary compatible error handler
 */
export function logErrorFromBoundary(error: Error, errorInfo: { componentStack: string }) {
  errorLogger.logError({
    error,
    componentName: 'Error Boundary',
    additionalData: {
      componentStack: errorInfo.componentStack,
      errorHandling: { wasHandled: false, didShowMessage: false } as ErrorHandlingMetadata,
    },
  });
}

/**
 * Helper to log errors with toast notifications.
 * Use when the user DOES see an error message (e.g. via toast).
 */
export function logAndToastError(error: Error | string, componentName?: string) {
  const message = typeof error === 'string' ? error : error.message;
  
  errorLogger.logError({
    error,
    componentName,
    additionalData: {
      errorHandling: {
        wasHandled: true,
        didShowMessage: true,
        messageChannel: 'toast',
      } as ErrorHandlingMetadata,
    },
  });

  // Return the message so it can be used with toast
  return message;
}

/**
 * Helper to log errors that are handled silently (no user-facing message).
 * Use when you catch an error but do NOT show anything to the user.
 */
export function logHandledError(
  error: Error | string,
  componentName?: string,
  additionalData?: Record<string, unknown> | null,
) {
  errorLogger.logError({
    error,
    componentName,
    additionalData: {
      ...additionalData,
      errorHandling: { wasHandled: true, didShowMessage: false } as ErrorHandlingMetadata,
    },
  });
}

