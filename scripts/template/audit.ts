import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

interface AuditFinding {
  file: string;
  pattern: string;
  sample: string;
  severity: 'critical' | 'review';
}

const ignoredDirectories = new Set([
  '.git',
  '.next',
  'node_modules',
  'coverage',
  'export-summary',
  'agent-transcripts',
  'reports',
]);

const ignoredPathParts = [
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  'template-setup.local.json',
  'template-setup-checklist.md',
  'testsuite/.state',
  'testsuite/reports',
  'playwright-report',
  'test-results',
];

const ignoredExtensions = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.ico',
  '.pdf',
  '.xlsx',
  '.docx',
]);

const patterns: Array<{ name: string; regex: RegExp; severity: AuditFinding['severity'] }> = [
  { name: 'Private key marker', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/i, severity: 'critical' },
  { name: 'JWT-looking token', regex: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/, severity: 'critical' },
  { name: 'Resend API key', regex: /re_[A-Za-z0-9]{20,}/, severity: 'critical' },
  {
    name: 'Likely real email domain',
    regex: /[A-Z0-9._%+-]+@(?!example\.com|example\.test|example\.local|demo\.example\.test|digidocs-demo\.test|test\.com|your-app\.example\.com)[A-Z0-9.-]+\.[A-Z]{2,}/i,
    severity: 'review',
  },
  { name: 'Placeholder app URL', regex: /your-app\.example\.com/i, severity: 'review' },
  { name: 'Legacy TemplateApp string', regex: /TemplateApp/, severity: 'review' },
  { name: 'Legacy client string', regex: /A\. & V\. TEMPLATE|Squ[i]res/i, severity: 'review' },
];

function shouldSkipFile(path: string): boolean {
  const normalized = relative(process.cwd(), path).replace(/\\/g, '/');
  return (
    ignoredPathParts.some((part) => normalized === part || normalized.startsWith(`${part}/`)) ||
    Array.from(ignoredExtensions).some((extension) => path.toLowerCase().endsWith(extension))
  );
}

function walk(directory: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(directory)) {
    if (ignoredDirectories.has(entry)) continue;

    const absolute = join(directory, entry);
    const stat = statSync(absolute);

    if (stat.isDirectory()) {
      files.push(...walk(absolute));
    } else if (!shouldSkipFile(absolute)) {
      files.push(absolute);
    }
  }

  return files;
}

function auditFile(file: string): AuditFinding[] {
  const relativePath = relative(process.cwd(), file);
  if (relativePath.replace(/\\/g, '/') === 'scripts/template/audit.ts') return [];

  const content = readFileSync(file, 'utf8');
  const findings: AuditFinding[] = [];

  for (const pattern of patterns) {
    const match = content.match(pattern.regex);
    if (match) {
      findings.push({
        file: relativePath,
        pattern: pattern.name,
        sample: pattern.severity === 'critical' ? '[redacted]' : match[0].slice(0, 120),
        severity: pattern.severity,
      });
    }
  }

  return findings;
}

function main() {
  const findings = walk(process.cwd()).flatMap(auditFile);

  if (findings.length === 0) {
    console.log('Template audit passed: no high-risk patterns found.');
    return;
  }

  const criticalFindings = findings.filter((finding) => finding.severity === 'critical');

  for (const finding of findings) {
    const prefix = finding.severity === 'critical' ? 'CRITICAL' : 'REVIEW';
    console.log(`${prefix}: ${finding.file}: ${finding.pattern} (${finding.sample})`);
  }

  console.log(
    `Template audit found ${criticalFindings.length} critical item(s) and ${
      findings.length - criticalFindings.length
    } review item(s).`
  );

  if (criticalFindings.length > 0) process.exit(1);
}

main();
