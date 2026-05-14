import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

interface AuditFinding {
  file: string;
  pattern: string;
  sample: string;
}

const ignoredDirectories = new Set([
  '.git',
  '.next',
  'node_modules',
  'coverage',
  'export-summary',
  'agent-transcripts',
]);

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

const patterns = [
  { name: 'Private key marker', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/i },
  { name: 'Supabase service role JWT', regex: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/ },
  { name: 'Resend API key', regex: /re_[A-Za-z0-9]{20,}/ },
  { name: 'Likely real email domain', regex: /[A-Z0-9._%+-]+@(?!example\.com|example\.test|demo\.example\.test|fieldops-template\.test)[A-Z0-9.-]+\.[A-Z]{2,}/i },
  { name: 'Placeholder app URL', regex: /your-app\.example\.com/i },
  { name: 'Legacy TemplateApp string', regex: /TemplateApp/ },
  { name: 'Legacy FieldOps Template string', regex: /FieldOps Template/ },
  { name: 'Old PDF company placeholder', regex: /A\. & V\. TEMPLATE|Example Client Ltd/ },
];

function shouldSkipFile(path: string): boolean {
  return Array.from(ignoredExtensions).some((extension) => path.toLowerCase().endsWith(extension));
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
        sample: match[0].slice(0, 120),
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

  for (const finding of findings) {
    console.log(`${finding.file}: ${finding.pattern} (${finding.sample})`);
  }

  console.log(`Template audit found ${findings.length} item(s) for review.`);
  process.exit(1);
}

main();
