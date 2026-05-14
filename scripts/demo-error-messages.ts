/**
 * Demonstration of error messages that will be logged
 * Shows what you'll see in the Debug Console
 */

export {};

class MockRequest {
  public url: string;
  public method: string;
  public headers: Map<string, string>;

  constructor(url: string, method: string = 'GET') {
    this.url = url;
    this.method = method;
    this.headers = new Map([
      ['user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/143.0.0.0'],
      ['referer', 'https://your-app.example.com/rams'],
      ['origin', 'https://your-app.example.com'],
    ]);
  }

  get(key: string): string | null {
    return this.headers.get(key) || null;
  }
}

function extractRequestContext(request: MockRequest): Record<string, unknown> {
  const url = new URL(request.url);
  return {
    method: request.method,
    pathname: url.pathname,
    searchParams: Object.fromEntries(url.searchParams.entries()),
    referer: request.headers.get('referer') || null,
    origin: request.headers.get('origin') || null,
  };
}

function generateErrorDescription(
  error: Error,
  componentName: string | null,
  requestContext: Record<string, unknown>
): string {
  const parts: string[] = [];
  if (componentName) parts.push(`Error in ${componentName}`);
  if (requestContext.method && requestContext.pathname) {
    parts.push(`${requestContext.method} ${requestContext.pathname}`);
  }
  if (error.name && error.name !== 'Error') parts.push(`(${error.name})`);
  parts.push(`- ${error.message}`);
  if (requestContext.searchParams && Object.keys(requestContext.searchParams as object).length > 0) {
    parts.push(`\nQuery params: ${JSON.stringify(requestContext.searchParams, null, 2)}`);
  }
  return parts.join(' ');
}

console.log('🔍 Error Message Examples - What You\'ll See in Debug Console\n');
console.log('='.repeat(70) + '\n');

// Example 1: RAMS API Error
console.log('📍 Example 1: RAMS Document Not Found\n');
const error1 = new Error('RAMS document not found in database');
const req1 = new MockRequest('https://your-app.example.com/api/rams/abc123/email?notify=true', 'POST');
const ctx1 = extractRequestContext(req1);
const msg1 = generateErrorDescription(error1, 'POST /api/rams/[id]/email', ctx1);
console.log('MESSAGE:');
console.log(msg1);
console.log('\nADDITIONAL DATA:');
console.log(JSON.stringify({
  ...ctx1,
  errorContext: {
    originalMessage: error1.message,
    errorName: error1.name,
  }
}, null, 2));
console.log('\n' + '-'.repeat(70) + '\n');

// Example 2: Timesheet Approval Error
console.log('📍 Example 2: Timesheet Approval Failed\n');
const error2 = new TypeError('Cannot read property \'user_id\' of undefined');
const req2 = new MockRequest('https://your-app.example.com/api/timesheets/xyz789/adjust', 'POST');
const ctx2 = extractRequestContext(req2);
const msg2 = generateErrorDescription(error2, 'POST /api/timesheets/[id]/adjust', ctx2);
console.log('MESSAGE:');
console.log(msg2);
console.log('\nADDITIONAL DATA:');
console.log(JSON.stringify({
  ...ctx2,
  errorContext: {
    originalMessage: error2.message,
    errorName: error2.name,
  }
}, null, 2));
console.log('\n' + '-'.repeat(70) + '\n');

// Example 3: Database Query Error
console.log('📍 Example 3: Database Connection Error\n');
const error3 = new Error('Connection to database failed');
const req3 = new MockRequest('https://your-app.example.com/api/reports/timesheets/payroll?start_date=2025-01-01&end_date=2025-01-31', 'GET');
const ctx3 = extractRequestContext(req3);
const msg3 = generateErrorDescription(error3, 'GET /api/reports/timesheets/payroll', ctx3);
console.log('MESSAGE:');
console.log(msg3);
console.log('\nADDITIONAL DATA:');
console.log(JSON.stringify({
  ...ctx3,
  errorContext: {
    originalMessage: error3.message,
    errorName: error3.name,
  }
}, null, 2));
console.log('\n' + '-'.repeat(70) + '\n');

// Example 4: Client-Side Error
console.log('📍 Example 4: Client-Side JavaScript Error\n');
const error4 = new ReferenceError('setRamsDocuments is not defined');
error4.stack = `ReferenceError: setRamsDocuments is not defined
    at fetchAllEntities (page.tsx:240:9)
    at useEffect (page.tsx:154:7)`;
console.log('MESSAGE:');
console.log(`Uncaught Error: ${error4.message} at page.tsx:240:9`);
console.log('\nADDITIONAL DATA:');
console.log(JSON.stringify({
  filename: 'https://your-app.example.com/_next/static/chunks/app/(dashboard)/debug/page.js',
  lineno: 240,
  colno: 9,
  location: 'page.tsx:240:9',
  description: 'Unhandled JavaScript error thrown at runtime',
  pageUrl: 'https://your-app.example.com/debug'
}, null, 2));
console.log('\nSTACK TRACE:');
console.log(error4.stack);
console.log('\n' + '-'.repeat(70) + '\n');

// Example 5: Promise Rejection
console.log('📍 Example 5: Unhandled Promise Rejection\n');
const error5 = new Error('Failed to fetch user data from API');
console.log('MESSAGE:');
console.log(`Unhandled Promise Rejection: ${error5.message}`);
console.log('\nADDITIONAL DATA:');
console.log(JSON.stringify({
  reason: error5,
  reasonType: 'object',
  description: 'Promise was rejected but no .catch() handler was attached',
  pageUrl: 'https://your-app.example.com/rams'
}, null, 2));
console.log('\n' + '-'.repeat(70) + '\n');

console.log('\n✨ Summary\n');
console.log('These error messages show:\n');
console.log('✅ Clear description of what failed');
console.log('✅ Which API endpoint or component had the error');
console.log('✅ HTTP method (GET, POST, etc.)');
console.log('✅ Query parameters when present');
console.log('✅ Full context for debugging');
console.log('✅ Original error details preserved\n');
console.log('All of this will appear automatically in /debug when errors occur! 🎉\n');
