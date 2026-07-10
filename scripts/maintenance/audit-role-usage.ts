import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const excludeDirs = ['node_modules', '.next', '.git', 'dist', 'build'];
const includeExts = ['.ts', '.tsx', '.js', '.jsx'];

interface Issue {
  file: string;
  line: number;
  code: string;
  severity: 'high' | 'medium' | 'low';
  reason: string;
}

const issues: Issue[] = [];

// Patterns to look for (potential issues with old role field)
const dangerousPatterns = [
  {
    pattern: /\.role\s*===?\s*['"](?:admin|manager|employee)/gi,
    severity: 'high' as const,
    reason: 'Direct comparison with old role field value'
  },
  {
    pattern: /profiles?\.role(?!_)/gi,
    severity: 'medium' as const,
    reason: 'Reference to profile.role (should use role_id or joined roles)'
  },
  {
    pattern: /WHERE\s+role\s+(?:IN|=)/gi,
    severity: 'high' as const,
    reason: 'SQL WHERE clause using old role field'
  },
  {
    pattern: /\.eq\(['"]role['"]/gi,
    severity: 'high' as const,
    reason: 'Supabase query filtering on old role field'
  },
  {
    pattern: /role:\s*['"](?:admin|manager|employee)/gi,
    severity: 'medium' as const,
    reason: 'Object literal with role value'
  },
];

function scanFile(filePath: string) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      dangerousPatterns.forEach(({ pattern, severity, reason }) => {
        const matches = line.match(pattern);
        if (matches) {
          issues.push({
            file: filePath,
            line: index + 1,
            code: line.trim(),
            severity,
            reason
          });
        }
      });
    });
  } catch {
    // Ignore errors
  }
}

function scanDirectory(dir: string) {
  try {
    const items = readdirSync(dir);

    for (const item of items) {
      const fullPath = join(dir, item);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        if (!excludeDirs.includes(item)) {
          scanDirectory(fullPath);
        }
      } else if (stat.isFile()) {
        const ext = item.substring(item.lastIndexOf('.'));
        if (includeExts.includes(ext)) {
          scanFile(fullPath);
        }
      }
    }
  } catch {
    // Ignore errors
  }
}

console.log('🔍 Auditing codebase for old role field usage...\n');

// Scan key directories
['app', 'components', 'lib', 'types'].forEach(dir => {
  if (statSync(dir).isDirectory()) {
    scanDirectory(dir);
  }
});

// Group issues by severity
const highIssues = issues.filter(i => i.severity === 'high');
const mediumIssues = issues.filter(i => i.severity === 'medium');
const lowIssues = issues.filter(i => i.severity === 'low');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`📊 AUDIT RESULTS: ${issues.length} potential issues found`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

if (highIssues.length > 0) {
  console.log(`🔴 HIGH PRIORITY (${highIssues.length} issues):`);
  console.log('   These MUST be fixed - they will cause runtime errors\n');
  highIssues.forEach(issue => {
    console.log(`   ${issue.file}:${issue.line}`);
    console.log(`   Reason: ${issue.reason}`);
    console.log(`   Code: ${issue.code.substring(0, 100)}`);
    console.log('');
  });
}

if (mediumIssues.length > 0) {
  console.log(`🟡 MEDIUM PRIORITY (${mediumIssues.length} issues):`);
  console.log('   These should be reviewed - may cause issues\n');
  mediumIssues.forEach(issue => {
    console.log(`   ${issue.file}:${issue.line}`);
    console.log(`   Reason: ${issue.reason}`);
    console.log(`   Code: ${issue.code.substring(0, 100)}`);
    console.log('');
  });
}

if (lowIssues.length > 0) {
  console.log(`🟢 LOW PRIORITY (${lowIssues.length} issues):`);
  console.log('   These are minor - review when convenient\n');
}

if (issues.length === 0) {
  console.log('✅ No issues found! Codebase looks clean.\n');
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('AUDIT COMPLETE');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

process.exit(issues.filter(i => i.severity === 'high').length > 0 ? 1 : 0);

