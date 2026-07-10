import { NextRequest, NextResponse } from 'next/server';
import { createDebugAccessErrorBody } from '@/lib/server/debug-console-access';
import { requireErrorLogAdminAccess } from '@/lib/server/error-logs';
import { logServerError } from '@/lib/utils/server-error-logger';

/**
 * Test endpoint for verifying server-side error logging
 * GET /api/test-error-logging?type=throw|catch|async
 */
export async function GET(request: NextRequest) {
  const access = await requireErrorLogAdminAccess();
  if (!access.ok) {
    return NextResponse.json(createDebugAccessErrorBody(access), { status: access.status });
  }

  const searchParams = request.nextUrl.searchParams;
  const type = searchParams.get('type') || 'throw';

  try {
    if (type === 'client') {
      try {
        throw new Error('Test client-side error: Button click handler failed');
      } catch (error) {
        await logServerError({
          error: error as Error,
          request,
          componentName: 'GET /api/test-error-logging client marker',
          additionalData: {
            testType: 'client_marker',
            endpoint: '/api/test-error-logging',
            description: 'Test marker used to verify client-triggered error visibility in the debug console',
          },
        });

        return NextResponse.json({
          success: true,
          message: 'Client error marker logged',
        });
      }
    } else if (type === 'throw') {
      // Test 1: Thrown error
      throw new Error('Test server-side error: Simulated API failure');
    } else if (type === 'catch') {
      // Test 2: Caught and logged error
      try {
        throw new Error('Test caught error: Database connection failed');
      } catch (error) {
        await logServerError({
          error: error as Error,
          request,
          componentName: 'GET /api/test-error-logging',
          additionalData: {
            testType: 'manual_catch',
            endpoint: '/api/test-error-logging',
            queryParams: Object.fromEntries(searchParams.entries()),
          },
        });
        
        return NextResponse.json({
          success: false,
          error: 'Error was caught and logged',
          message: 'Check the debug console to see the logged error'
        }, { status: 500 });
      }
    } else if (type === 'async') {
      // Test 3: Async error
      const result = await someAsyncFunction();
      return NextResponse.json({ result });
    }

    return NextResponse.json({ 
      success: true,
      message: 'No error thrown'
    });

  } catch (error) {
    // This catch block will have automatic logging added
    console.error('Error in test-error-logging endpoint:', error);
    
    await logServerError({
      error: error as Error,
      request,
      componentName: 'GET /api/test-error-logging',
      additionalData: {
        testType: type,
        endpoint: '/api/test-error-logging',
        description: 'This is a test error to verify server-side error logging works correctly',
      },
    });
    
    return NextResponse.json(
      { error: 'Test error logged successfully. Check /debug to view it.' },
      { status: 500 }
    );
  }
}

async function someAsyncFunction() {
  await new Promise(resolve => setTimeout(resolve, 100));
  throw new Error('Test async error: Promise rejection in API route');
}
