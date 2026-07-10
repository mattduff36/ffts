/**
 * Server-Side Error Logger
 * Logs errors from API routes to the error_logs table
 */

import { insertErrorLogs } from '@/lib/server/error-logs';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { trackServerUsageEvent } from '@/lib/server/user-analytics';
import type { Json } from '@/types/database';

export interface ServerErrorLog {
  error_message: string;
  error_stack: string | null;
  error_type: string;
  user_id: string | null;
  user_email: string | null;
  page_url: string;
  user_agent: string;
  component_name: string | null;
  additional_data: Json;
}

/**
 * Extract useful context from the request
 */
function extractRequestContext(request?: Request | null): Record<string, unknown> {
  if (!request) {
    return {
      method: 'UNKNOWN',
      pathname: 'N/A',
      searchParams: {},
      referer: null,
      origin: null,
    };
  }
  
  const url = new URL(request.url);
  
  return {
    method: request.method,
    pathname: url.pathname,
    searchParams: Object.fromEntries(url.searchParams.entries()),
    referer: request.headers.get('referer') || null,
    origin: request.headers.get('origin') || null,
  };
}

/**
 * Generate a human-readable error description
 */
function generateErrorDescription(
  error: Error,
  componentName: string | null,
  requestContext: Record<string, unknown>
): string {
  const parts: string[] = [];
  
  // Add component context
  if (componentName) {
    parts.push(`Error in ${componentName}`);
  }
  
  // Add HTTP method and endpoint
  if (requestContext.method && requestContext.pathname) {
    parts.push(`${requestContext.method} ${requestContext.pathname}`);
  }
  
  // Add error type if it's not generic
  if (error.name && error.name !== 'Error') {
    parts.push(`(${error.name})`);
  }
  
  // Add the actual error message
  parts.push(`- ${error.message}`);
  
  // Add query params if present
  if (requestContext.searchParams && Object.keys(requestContext.searchParams as object).length > 0) {
    parts.push(`\nQuery params: ${JSON.stringify(requestContext.searchParams, null, 2)}`);
  }
  
  return parts.join(' ');
}

/**
 * Log an error from a server-side API route
 */
export async function logServerError({
  error,
  request = null,
  componentName = null,
  additionalData = null,
  userId = null,
  userEmail = null,
}: {
  error: Error | string;
  request?: Request | null;
  componentName?: string | null;
  additionalData?: Record<string, unknown> | null;
  userId?: string | null;
  userEmail?: string | null;
}): Promise<void> {
  try {
    const errorObj = typeof error === 'string' ? new Error(error) : error;

    // If user info not provided, try to get it from the app session
    let finalUserId = userId;
    let finalUserEmail = userEmail;
    
    if (!finalUserId || !finalUserEmail) {
      const current = await getCurrentAuthenticatedProfile({ includeEmail: true });
      finalUserId = finalUserId || current?.profile.id || null;
      finalUserEmail = finalUserEmail || current?.profile.email || null;
    }

    // Extract request context
    const requestContext = extractRequestContext(request);
    
    // Generate enhanced error description
    const enhancedMessage = generateErrorDescription(errorObj, componentName, requestContext);
    
    // Merge request context with additional data.
    // Preserve caller-supplied errorHandling if present; otherwise default to unknown.
    const enrichedData = {
      ...requestContext,
      ...additionalData,
      errorContext: {
        originalMessage: errorObj.message,
        errorName: errorObj.name,
        timestamp: new Date().toISOString(),
      },
      errorHandling: (additionalData as Record<string, unknown> | null)?.errorHandling ?? {
        wasHandled: true,
        didShowMessage: null,
      },
    } as Json;

    const errorLog: ServerErrorLog = {
      error_message: enhancedMessage,
      error_stack: errorObj.stack || null,
      error_type: errorObj.name || 'Error',
      user_id: finalUserId,
      user_email: finalUserEmail,
      page_url: request?.url || 'N/A',
      user_agent: request?.headers.get('user-agent') || 'N/A',
      component_name: componentName,
      additional_data: enrichedData,
    };

    // Insert into database using admin access so auth failures can still be recorded.
    await insertErrorLogs([{
        ...errorLog,
        timestamp: new Date().toISOString(),
      }]);
    await trackServerUsageEvent({
      eventName: 'error_observed',
      userId: finalUserId,
      request,
      metadata: {
        componentName,
        errorType: errorObj.name || 'Error',
        originalMessage: errorObj.message,
        requestContext,
      },
    });
  } catch (err) {
    // Silent fail - don't want error logging to break the app
    console.warn('[Server Error Logger] Failed to log error:', err);
  }
}

/**
 * Wrap an API route handler with automatic error logging
 */
export function withErrorLogging<T>(
  handler: (request: Request, ...args: unknown[]) => Promise<T>,
  componentName: string
) {
  return async (request: Request, ...args: unknown[]): Promise<T> => {
    try {
      return await handler(request, ...args);
    } catch (error) {
      // Log the error
      await logServerError({
        error: error as Error,
        request,
        componentName,
      });
      
      // Re-throw to let the caller handle it
      throw error;
    }
  };
}
