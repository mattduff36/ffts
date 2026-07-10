'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { AlertCircle, Bug, CheckCircle2 } from 'lucide-react';
import { PageLoader } from '@/components/ui/page-loader';
import { useAuth } from '@/lib/hooks/useAuth';
import { canAccessDebugConsole } from '@/lib/utils/debug-access';

interface BrowserErrorLogger {
  logError: (input: {
    error: Error;
    componentName?: string;
    additionalData?: Record<string, unknown>;
  }) => Promise<void>;
}

export default function TestErrorLoggingPage() {
  const router = useRouter();
  const { profile, loading, isActualSuperAdmin, isViewingAs } = useAuth();
  const [results, setResults] = useState<string[]>([]);
  const canAccessDebugTools = canAccessDebugConsole({
    email: profile?.email,
    isActualSuperAdmin,
    isViewingAs,
  });

  useEffect(() => {
    if (loading) return;
    if (!profile) {
      router.replace('/login');
      return;
    }
    if (!canAccessDebugTools) {
      router.replace('/dashboard');
    }
  }, [canAccessDebugTools, loading, profile, router]);

  if (loading) {
    return <PageLoader message="Checking debug access..." />;
  }

  if (!profile || !canAccessDebugTools) {
    return <PageLoader message="Redirecting..." />;
  }

  const addResult = (message: string) => {
    setResults(prev => [...prev, `${new Date().toLocaleTimeString()}: ${message}`]);
  };

  const testClientError = async () => {
    addResult('Testing client-side error...');
    try {
      throw new Error('Test client-side error: Button click handler failed');
    } catch (error) {
      console.error('Test client error:', error);
      const errorObj = error instanceof Error ? error : new Error(String(error));
      await (window as Window & { errorLogger?: BrowserErrorLogger }).errorLogger?.logError({
        error: errorObj,
        componentName: 'ErrorLoggingTestPage',
        additionalData: {
          testSource: 'testClientError',
        },
      });
      await fetch('/api/errors/log', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          logs: [{
            timestamp: new Date().toISOString(),
            error_message: errorObj.message,
            error_stack: errorObj.stack || null,
            error_type: errorObj.name,
            page_url: window.location.href,
            user_agent: navigator.userAgent,
            component_name: 'ErrorLoggingTestPage',
            additional_data: {
              testSource: 'testClientErrorDirectPersist',
            },
          }],
        }),
      });
      await fetch('/api/test-error-logging?type=client');
      addResult('✅ Client error thrown and logged');
      toast.error('Client error logged! Check /debug');
    }
  };

  const testPromiseRejection = () => {
    addResult('Testing promise rejection...');
    Promise.reject(new Error('Test promise rejection: Async operation failed'))
      .catch(() => {
        addResult('✅ Promise rejection logged');
        toast.error('Promise rejection logged! Check /debug');
      });
  };

  const testUncaughtError = () => {
    addResult('Testing uncaught error (this will be caught by global handler)...');
    toast.info('Throwing uncaught error in 1 second...');
    
    setTimeout(() => {
      throw new Error('Test uncaught error: Delayed error from setTimeout');
    }, 1000);
    
    setTimeout(() => {
      addResult('✅ Uncaught error should be logged');
      toast.success('Check /debug for the uncaught error');
    }, 2000);
  };

  const testServerError = async (type: 'throw' | 'catch' | 'async') => {
    addResult(`Testing server-side error (${type})...`);
    try {
      const response = await fetch(`/api/test-error-logging?type=${type}`);
      const data = await response.json();
      
      if (!response.ok) {
        addResult(`✅ Server error response received: ${data.error}`);
        toast.error('Server error logged! Check /debug');
      } else {
        addResult(`❌ No error occurred: ${data.message}`);
      }
    } catch (_error) {
      addResult(`✅ Fetch error caught: ${_error instanceof Error ? _error.message : 'Unknown'}`);
      toast.error('Server error logged! Check /debug');
    }
  };

  const testApiWithContext = async () => {
    addResult('Testing API error with rich context...');
    try {
      const response = await fetch('/api/rams/nonexistent-id/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: 'data' })
      });
      
      await response.json();
      addResult(`✅ API call completed with status ${response.status}`);
      
      if (!response.ok) {
        toast.info('Real API error logged with context!');
      }
    } catch (_error) {
      addResult(`✅ API error: ${_error instanceof Error ? _error.message : 'Unknown'}`);
      toast.error('API error logged! Check /debug');
    }
  };

  const runAllTests = async () => {
    setResults([]);
    addResult('🚀 Starting comprehensive error logging tests...');
    
    // Client-side tests
    await testClientError();
    await new Promise(resolve => setTimeout(resolve, 500));
    
    testPromiseRejection();
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Server-side tests
    await testServerError('throw');
    await new Promise(resolve => setTimeout(resolve, 500));
    
    await testServerError('catch');
    await new Promise(resolve => setTimeout(resolve, 500));
    
    await testServerError('async');
    await new Promise(resolve => setTimeout(resolve, 500));
    
    await testApiWithContext();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    addResult('✨ All tests completed! Check /debug to view logged errors');
    toast.success('All tests completed! Navigate to /debug to view results', {
      duration: 5000,
    });
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="bg-gradient-to-r from-blue-500 to-purple-500 rounded-lg p-6 text-white">
        <div className="flex items-center gap-3">
          <Bug className="h-8 w-8" />
          <div>
            <h1 className="text-3xl font-bold mb-2">Error Logging Test Suite</h1>
            <p className="text-blue-100">
              Test both client-side and server-side error logging
            </p>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Test Controls</CardTitle>
          <CardDescription>
            Run individual tests or all tests at once. All errors will be logged to the database.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Button onClick={testClientError} variant="outline" className="w-full">
              <AlertCircle className="h-4 w-4 mr-2" />
              Test Client Error
            </Button>
            
            <Button onClick={testPromiseRejection} variant="outline" className="w-full">
              <AlertCircle className="h-4 w-4 mr-2" />
              Test Promise Rejection
            </Button>
            
            <Button onClick={testUncaughtError} variant="outline" className="w-full">
              <AlertCircle className="h-4 w-4 mr-2" />
              Test Uncaught Error
            </Button>
            
            <Button onClick={() => testServerError('throw')} variant="outline" className="w-full">
              <AlertCircle className="h-4 w-4 mr-2" />
              Test Server Error (Throw)
            </Button>
            
            <Button onClick={() => testServerError('catch')} variant="outline" className="w-full">
              <AlertCircle className="h-4 w-4 mr-2" />
              Test Server Error (Catch)
            </Button>
            
            <Button onClick={() => testServerError('async')} variant="outline" className="w-full">
              <AlertCircle className="h-4 w-4 mr-2" />
              Test Server Error (Async)
            </Button>
            
            <Button onClick={testApiWithContext} variant="outline" className="w-full md:col-span-2">
              <AlertCircle className="h-4 w-4 mr-2" />
              Test Real API Error (with context)
            </Button>
          </div>

          <div className="pt-4 border-t">
            <Button onClick={runAllTests} className="w-full" size="lg">
              <Bug className="h-5 w-5 mr-2" />
              Run All Tests
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Test Results</CardTitle>
          <CardDescription>
            Real-time test execution log
          </CardDescription>
        </CardHeader>
        <CardContent>
          {results.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CheckCircle2 className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No tests run yet. Click a button above to start testing.</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {results.map((result, index) => (
                <div
                  key={index}
                  className="text-sm font-mono bg-muted/50 rounded px-3 py-2 border"
                >
                  {result}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-900">
        <CardHeader>
          <CardTitle className="text-blue-900 dark:text-blue-100">Next Steps</CardTitle>
        </CardHeader>
        <CardContent className="text-blue-800 dark:text-blue-200">
          <ol className="list-decimal list-inside space-y-2">
            <li>Run the tests above</li>
            <li>Navigate to <code className="bg-blue-100 dark:bg-blue-900 px-2 py-1 rounded">/debug</code> page</li>
            <li>Click the &quot;Error Log&quot; tab</li>
            <li>Verify that all test errors appear with full details</li>
            <li>Check that each error has clear descriptions and context</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
