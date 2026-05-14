/**
 * Comprehensive Test Suite for Reports System
 * 
 * This script tests all report generation endpoints and the statistics API
 * Run with: npx tsx scripts/test-reports.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  duration: number;
}

const testResults: TestResult[] = [];
let testsPassed = 0;
let testsFailed = 0;

// Configuration
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:4000';
const TEST_USER_EMAIL = process.env.TEST_ADMIN_EMAIL || 'admin@example.test';
const TEST_USER_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'TestPass123!';

let authCookie: string = '';

/**
 * Utility function to log test results
 */
function logTest(name: string, passed: boolean, message: string, duration: number) {
  const status = passed 
    ? `${colors.green}✓ PASS${colors.reset}` 
    : `${colors.red}✗ FAIL${colors.reset}`;
  
  console.log(`${status} ${name} (${duration}ms)`);
  if (!passed) {
    console.log(`  ${colors.red}${message}${colors.reset}`);
  }
  
  testResults.push({ name, passed, message, duration });
  
  if (passed) {
    testsPassed++;
  } else {
    testsFailed++;
  }
}

/**
 * Authentication helper
 */
async function authenticate(): Promise<boolean> {
  const startTime = Date.now();
  try {
    console.log(`\n${colors.cyan}Authenticating as test user...${colors.reset}`);
    
    const response = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: TEST_USER_EMAIL,
        password: TEST_USER_PASSWORD,
      }),
    });

    if (response.ok) {
      const cookies = response.headers.get('set-cookie');
      if (cookies) {
        authCookie = cookies;
      }
      logTest('Authentication', true, 'Successfully authenticated', Date.now() - startTime);
      return true;
    } else {
      logTest('Authentication', false, `Failed with status ${response.status}`, Date.now() - startTime);
      return false;
    }
  } catch (error) {
    logTest('Authentication', false, `Error: ${error}`, Date.now() - startTime);
    return false;
  }
}

/**
 * Test statistics API endpoint
 */
async function testStatisticsAPI(): Promise<void> {
  const startTime = Date.now();
  try {
    const response = await fetch(`${BASE_URL}/api/reports/stats`, {
      headers: {
        'Cookie': authCookie,
      },
    });

    if (!response.ok) {
      logTest('Statistics API', false, `HTTP ${response.status}`, Date.now() - startTime);
      return;
    }

    const data = await response.json();
    
    // Validate response structure
    const hasRequiredFields = 
      data.timesheets &&
      data.inspections &&
      data.employees &&
      data.summary &&
      typeof data.timesheets.weekHours === 'number' &&
      typeof data.inspections.passRate === 'number';

    if (hasRequiredFields) {
      logTest('Statistics API', true, 'All required fields present', Date.now() - startTime);
    } else {
      logTest('Statistics API', false, 'Missing required fields in response', Date.now() - startTime);
    }
  } catch (error) {
    logTest('Statistics API', false, `Error: ${error}`, Date.now() - startTime);
  }
}

/**
 * Test report generation
 */
async function testReportGeneration(
  name: string,
  endpoint: string,
  params: Record<string, string> = {}
): Promise<void> {
  const startTime = Date.now();
  try {
    // Set default date range
    const today = new Date().toISOString().split('T')[0];
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateFrom = thirtyDaysAgo.toISOString().split('T')[0];

    const queryParams = new URLSearchParams({
      dateFrom,
      dateTo: today,
      ...params,
    });

    const response = await fetch(`${BASE_URL}${endpoint}?${queryParams}`, {
      headers: {
        'Cookie': authCookie,
      },
    });

    // Check if response is OK or 404 (no data) which is acceptable
    if (response.ok) {
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')) {
        const blob = await response.blob();
        const size = blob.size;
        
        if (size > 0) {
          logTest(name, true, `Generated ${(size / 1024).toFixed(2)} KB Excel file`, Date.now() - startTime);
        } else {
          logTest(name, false, 'Generated empty file', Date.now() - startTime);
        }
      } else {
        logTest(name, false, `Unexpected content type: ${contentType}`, Date.now() - startTime);
      }
    } else if (response.status === 404) {
      // 404 is acceptable - means no data for the date range
      logTest(name, true, 'No data found (404) - acceptable', Date.now() - startTime);
    } else {
      const error = await response.text();
      logTest(name, false, `HTTP ${response.status}: ${error}`, Date.now() - startTime);
    }
  } catch (error) {
    logTest(name, false, `Error: ${error}`, Date.now() - startTime);
  }
}

/**
 * Test Excel utility functions
 */
async function testExcelUtilities(): Promise<void> {
  const startTime = Date.now();
  try {
    // This would require importing the actual module, but we'll do a basic check
    const excelUtilPath = path.join(process.cwd(), 'lib/utils/excel.ts');
    
    if (fs.existsSync(excelUtilPath)) {
      const content = fs.readFileSync(excelUtilPath, 'utf-8');
      
      // Check for required function exports
      const hasGenerateExcelFile = content.includes('export function generateExcelFile');
      const hasFormatExcelDate = content.includes('export function formatExcelDate');
      const hasFormatExcelHours = content.includes('export function formatExcelHours');
      
      if (hasGenerateExcelFile && hasFormatExcelDate && hasFormatExcelHours) {
        logTest('Excel Utilities', true, 'All required functions exported', Date.now() - startTime);
      } else {
        logTest('Excel Utilities', false, 'Missing required function exports', Date.now() - startTime);
      }
    } else {
      logTest('Excel Utilities', false, 'excel.ts file not found', Date.now() - startTime);
    }
  } catch (error) {
    logTest('Excel Utilities', false, `Error: ${error}`, Date.now() - startTime);
  }
}

/**
 * Test API route files exist
 */
async function testAPIRoutesExist(): Promise<void> {
  const routes = [
    'app/api/reports/stats/route.ts',
    'app/api/reports/timesheets/summary/route.ts',
    'app/api/reports/timesheets/payroll/route.ts',
    'app/api/reports/inspections/compliance/route.ts',
    'app/api/reports/inspections/defects/route.ts',
  ];

  for (const route of routes) {
    const startTime = Date.now();
    const fullPath = path.join(process.cwd(), route);
    const exists = fs.existsSync(fullPath);
    
    logTest(
      `Route exists: ${route}`,
      exists,
      exists ? 'File found' : 'File not found',
      Date.now() - startTime
    );
  }
}

/**
 * Test authorization (non-admin should be denied)
 */
async function testAuthorization(): Promise<void> {
  const startTime = Date.now();
  try {
    // Try to access stats without auth
    const response = await fetch(`${BASE_URL}/api/reports/stats`);
    
    if (response.status === 401) {
      logTest('Authorization Check', true, 'Unauthorized access denied (401)', Date.now() - startTime);
    } else {
      logTest('Authorization Check', false, `Expected 401, got ${response.status}`, Date.now() - startTime);
    }
  } catch (error) {
    logTest('Authorization Check', false, `Error: ${error}`, Date.now() - startTime);
  }
}

/**
 * Main test runner
 */
async function runTests() {
  console.log(`\n${colors.blue}╔════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.blue}║    Template Reports System - Test Suite        ║${colors.reset}`);
  console.log(`${colors.blue}╚════════════════════════════════════════════════╝${colors.reset}\n`);
  
  console.log(`${colors.cyan}Testing against: ${BASE_URL}${colors.reset}\n`);

  // Phase 1: File Structure Tests
  console.log(`\n${colors.yellow}═══ Phase 1: File Structure Tests ═══${colors.reset}`);
  await testExcelUtilities();
  await testAPIRoutesExist();

  // Phase 2: Authorization Tests
  console.log(`\n${colors.yellow}═══ Phase 2: Authorization Tests ═══${colors.reset}`);
  await testAuthorization();

  // Phase 3: Authentication
  console.log(`\n${colors.yellow}═══ Phase 3: Authentication ═══${colors.reset}`);
  const authenticated = await authenticate();
  
  if (!authenticated) {
    console.log(`\n${colors.red}Cannot continue tests without authentication${colors.reset}`);
    console.log(`${colors.yellow}Please ensure:${colors.reset}`);
    console.log(`  1. The development server is running (npm run dev)`);
    console.log(`  2. Test user exists: ${TEST_USER_EMAIL}`);
    console.log(`  3. BASE_URL is correct: ${BASE_URL}`);
    process.exit(1);
  }

  // Phase 4: Statistics API Tests
  console.log(`\n${colors.yellow}═══ Phase 4: Statistics API Tests ═══${colors.reset}`);
  await testStatisticsAPI();

  // Phase 5: Report Generation Tests
  console.log(`\n${colors.yellow}═══ Phase 5: Report Generation Tests ═══${colors.reset}`);
  await testReportGeneration(
    'Timesheet Summary Report',
    '/api/reports/timesheets/summary'
  );
  
  await testReportGeneration(
    'Payroll Export Report',
    '/api/reports/timesheets/payroll'
  );
  
  await testReportGeneration(
    'Inspection Compliance Report',
    '/api/reports/inspections/compliance'
  );
  
  await testReportGeneration(
    'Defects Log Report',
    '/api/reports/inspections/defects'
  );

  // Print summary
  console.log(`\n${colors.blue}╔════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.blue}║              Test Summary                      ║${colors.reset}`);
  console.log(`${colors.blue}╚════════════════════════════════════════════════╝${colors.reset}\n`);
  
  console.log(`Total Tests: ${testsPassed + testsFailed}`);
  console.log(`${colors.green}Passed: ${testsPassed}${colors.reset}`);
  console.log(`${colors.red}Failed: ${testsFailed}${colors.reset}`);
  console.log(`Success Rate: ${((testsPassed / (testsPassed + testsFailed)) * 100).toFixed(1)}%\n`);

  if (testsFailed > 0) {
    console.log(`${colors.yellow}Failed Tests:${colors.reset}`);
    testResults
      .filter(r => !r.passed)
      .forEach(r => {
        console.log(`  ${colors.red}✗${colors.reset} ${r.name}: ${r.message}`);
      });
    console.log();
  }

  // Save results to file
  const resultsPath = path.join(process.cwd(), 'test-results.json');
  fs.writeFileSync(resultsPath, JSON.stringify(testResults, null, 2));
  console.log(`${colors.cyan}Results saved to: ${resultsPath}${colors.reset}\n`);

  // Exit with appropriate code
  process.exit(testsFailed > 0 ? 1 : 0);
}

// Run tests
runTests().catch((error) => {
  console.error(`${colors.red}Fatal error: ${error}${colors.reset}`);
  process.exit(1);
});

