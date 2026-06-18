import { spawnSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import {
  getQuestionOptionLabel,
  questionnaireSections,
  type QuestionnaireAnswerValue,
  type QuestionnaireAnswers,
  type QuestionnaireQuestion,
} from '../../lib/questionnaire/demo-personalisation';
import type { Database, Json } from '../../types/database';

config({ path: path.resolve(process.cwd(), '.env.local') });

const REPO_ROOT = process.cwd();
const DEFAULT_BASE_BRANCH = 'main';
const GENERATED_ROOT = 'demo-personalisation';
const PUBLIC_GENERATED_ROOT = 'public/demo-personalisation';
const DEMO_BRANCH_CONFIG_PATH = 'lib/config/demo-branch-config.ts';
const MANIFEST_PATH = 'public/manifest.json';

type SubmissionRow = Database['public']['Tables']['questionnaire_submissions']['Row'];

interface Options {
  submissionNumber: number;
  baseBranch: string;
  push: boolean;
  dryRun: boolean;
  help: boolean;
}

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface ReadableAnswer {
  questionId: string;
  questionLabel: string;
  value: string | string[];
}

interface ReadableSection {
  sectionId: string;
  sectionTitle: string;
  answers: ReadableAnswer[];
}

interface ClientProfile {
  submission: SubmissionRow;
  answers: QuestionnaireAnswers;
  readableSections: ReadableSection[];
  branchName: string;
  generatedAt: string;
}

interface DemoBranchBranding {
  appName: string;
  shortAppName: string;
  companyName: string;
  brandColor: string;
  brandColorHover: string;
  brandColorLight: string;
  backgroundColor: string;
  logoPath: string;
  faviconPath: string;
  sourceUrl: string | null;
}

interface DemoBranchPdf {
  registeredOffice: string;
  contactLine: string;
  registrationLine: string;
}

interface DemoPersonalisation {
  branding: DemoBranchBranding;
  navigationPriorityHrefs: string[];
  pdf: DemoBranchPdf;
  assetNote: string;
}

interface BrandAssetResult {
  logoPath: string;
  faviconPath: string;
  sourceUrl: string | null;
  note: string;
}

interface ResolvedBrandColours {
  brandColor: string;
  brandColorHover: string;
  brandColorLight: string;
  backgroundColor: string;
}

interface RgbColour {
  r: number;
  g: number;
  b: number;
}

type ImageBuffer = Buffer<ArrayBufferLike>;

function getArgValue(argv: string[], name: string): string | undefined {
  const equalsPrefix = `--${name}=`;
  const equalsValue = argv.find((arg) => arg.startsWith(equalsPrefix))?.slice(equalsPrefix.length);
  if (equalsValue) {
    return equalsValue;
  }

  const index = argv.indexOf(`--${name}`);
  if (index === -1) {
    return undefined;
  }

  return argv[index + 1];
}

function parseArgs(argv: string[]): Options {
  const args = new Set(argv);
  const rawSubmission = getArgValue(argv, 'submission');
  const submissionNumber = Number(rawSubmission);

  return {
    submissionNumber,
    baseBranch: getArgValue(argv, 'base') || DEFAULT_BASE_BRANCH,
    push: args.has('--push'),
    dryRun: args.has('--dry-run'),
    help: args.has('--help') || args.has('-h'),
  };
}

function printUsage(): void {
  console.log([
    'Usage:',
    '  npm run demo:create-branch -- --submission 1',
    '  npm run demo:create-branch -- --submission 1 --push',
    '  npm run demo:create-branch -- --submission 1 --dry-run',
    '',
    'Options:',
    '  --submission <number>  Questionnaire reference/submission number.',
    '  --base <branch>        Base branch to create from. Defaults to main.',
    '  --push                 Push the new branch to origin after committing.',
    '  --dry-run              Fetch and summarise without changing files or git state.',
  ].join('\n'));
}

function assertValidOptions(options: Options): void {
  if (options.help) {
    return;
  }

  if (!Number.isInteger(options.submissionNumber) || options.submissionNumber < 1) {
    throw new Error('A positive --submission number is required.');
  }

  if (!/^[A-Za-z0-9._/-]+$/u.test(options.baseBranch)) {
    throw new Error('The --base branch contains unsupported characters.');
  }
}

function getExecutable(command: string): string {
  if (process.platform !== 'win32') {
    return command;
  }

  if (command === 'git') {
    return command;
  }

  if (command === 'npm') {
    return 'npm.cmd';
  }

  return command;
}

function runCommand(command: string, args: string[], captureOutput = false, allowFailure = false): CommandResult {
  const result = spawnSync(getExecutable(command), args, {
    cwd: REPO_ROOT,
    env: process.env,
    shell: process.platform === 'win32' && command !== 'git',
    encoding: 'utf8',
    stdio: captureOutput ? 'pipe' : 'inherit',
  });

  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';

  if (!allowFailure && result.status !== 0) {
    throw new Error(`Command failed: ${[command, ...args].join(' ')}`);
  }

  return {
    status: result.status,
    stdout,
    stderr,
  };
}

function assertCleanWorkingTree(): void {
  const status = runCommand('git', ['status', '--porcelain'], true).stdout.trim();
  if (!status) {
    return;
  }

  throw new Error('Refusing to create a demo branch while the working tree has uncommitted changes.');
}

function assertBranchAvailable(branchName: string): void {
  const local = runCommand('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branchName}`], true, true);
  if (local.status === 0) {
    throw new Error(`Local branch already exists: ${branchName}`);
  }

  const remote = runCommand('git', ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branchName}`], true, true);
  if (remote.status === 0) {
    throw new Error(`Remote branch already exists: origin/${branchName}`);
  }
}

function getCurrentBranch(): string {
  return runCommand('git', ['branch', '--show-current'], true).stdout.trim();
}

function getStringAnswer(answers: QuestionnaireAnswers, questionId: string): string {
  const value = answers[questionId];
  return typeof value === 'string' ? value.trim() : '';
}

function getStringArrayAnswer(answers: QuestionnaireAnswers, questionId: string): string[] {
  const value = answers[questionId];
  return Array.isArray(value) ? value : [];
}

function escapeXml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&apos;');
}

function trimCompanySuffix(value: string): string {
  return value
    .replace(/\b(limited|ltd|llp|plc|inc|co\.?|company|development|developments)\b/giu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function getShortCompanyName(companyName: string): string {
  const trimmed = trimCompanySuffix(companyName);
  return trimmed || companyName.split(/\s+/u)[0] || companyName;
}

function buildAppNames(profile: ClientProfile): Pick<DemoBranchBranding, 'appName' | 'shortAppName'> {
  const companyName = profile.submission.company_name;
  const shortCompanyName = getShortCompanyName(companyName);
  const preference = getStringAnswer(profile.answers, 'app_name_preference');

  if (preference === 'keep_digidocs') {
    return { appName: 'DigiDocs', shortAppName: 'DigiDocs' };
  }

  if (preference === 'company_docs') {
    return {
      appName: `${shortCompanyName} Docs`,
      shortAppName: `${shortCompanyName} Docs`.slice(0, 22),
    };
  }

  if (preference === 'company_operations' || preference === 'not_sure' || preference === 'custom') {
    return {
      appName: `${shortCompanyName} Operations`,
      shortAppName: `${shortCompanyName} Ops`.slice(0, 22),
    };
  }

  return {
    appName: `${shortCompanyName} Operations`,
    shortAppName: `${shortCompanyName} Ops`.slice(0, 22),
  };
}

const NAMED_COLOURS: Record<string, string> = {
  amber: '#f59e0b',
  black: '#111827',
  blue: '#2563eb',
  brown: '#92400e',
  charcoal: '#1f2937',
  cyan: '#0891b2',
  'dark blue': '#1e3a8a',
  'dark gray': '#1f2937',
  'dark grey': '#1f2937',
  gold: '#f59e0b',
  gray: '#4b5563',
  green: '#16a34a',
  grey: '#4b5563',
  indigo: '#4f46e5',
  lime: '#65a30d',
  navy: '#0f172a',
  orange: '#f97316',
  pink: '#db2777',
  purple: '#9333ea',
  red: '#dc2626',
  slate: '#334155',
  teal: '#0d9488',
  white: '#ffffff',
  yellow: '#facc15',
};

function normalizeHex(value: string): string | null {
  const trimmed = value.trim();
  const shortMatch = trimmed.match(/^#?([\da-f])([\da-f])([\da-f])$/iu);
  if (shortMatch) {
    return `#${shortMatch[1]}${shortMatch[1]}${shortMatch[2]}${shortMatch[2]}${shortMatch[3]}${shortMatch[3]}`.toUpperCase();
  }

  const fullMatch = trimmed.match(/^#?([\da-f]{6})$/iu);
  return fullMatch ? `#${fullMatch[1].toUpperCase()}` : null;
}

function hexToRgb(value: string): RgbColour | null {
  const hex = normalizeHex(value);
  if (!hex) {
    return null;
  }

  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function rgbToHex(colour: RgbColour): string {
  const toHex = (channel: number) => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, '0');
  return `#${toHex(colour.r)}${toHex(colour.g)}${toHex(colour.b)}`.toUpperCase();
}

function mixHex(base: string, target: string, amount: number): string {
  const baseRgb = hexToRgb(base);
  const targetRgb = hexToRgb(target);
  if (!baseRgb || !targetRgb) {
    return base;
  }

  return rgbToHex({
    r: baseRgb.r + (targetRgb.r - baseRgb.r) * amount,
    g: baseRgb.g + (targetRgb.g - baseRgb.g) * amount,
    b: baseRgb.b + (targetRgb.b - baseRgb.b) * amount,
  });
}

function isDarkBrandColour(label: string, colour: string): boolean {
  const normalizedLabel = label.toLowerCase();
  if (/\b(dark|black|charcoal|grey|gray|navy|slate)\b/u.test(normalizedLabel)) {
    return true;
  }

  const rgb = hexToRgb(colour);
  if (!rgb) {
    return false;
  }

  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luminance < 0.35;
}

function extractBrandColourCandidates(rawColours: string): Array<{ label: string; colour: string }> {
  const candidates: Array<{ label: string; colour: string }> = [];
  const hexMatches = rawColours.match(/#?[\da-f]{6}|#?[\da-f]{3}/giu) ?? [];
  for (const match of hexMatches) {
    const colour = normalizeHex(match);
    if (colour) {
      candidates.push({ label: match, colour });
    }
  }

  const normalized = rawColours.toLowerCase().replace(/[-_/]+/gu, ' ');
  const colourNames = Object.keys(NAMED_COLOURS).sort((left, right) => right.length - left.length);
  for (const colourName of colourNames) {
    if (new RegExp(`\\b${colourName.replace(/\s+/gu, '\\s+')}\\b`, 'u').test(normalized)) {
      candidates.push({ label: colourName, colour: NAMED_COLOURS[colourName] });
    }
  }

  return candidates;
}

function resolveBrandColours(answers: QuestionnaireAnswers): ResolvedBrandColours {
  const candidates = extractBrandColourCandidates(getStringAnswer(answers, 'brand_colours'));
  const darkCandidate = candidates.find((candidate) => isDarkBrandColour(candidate.label, candidate.colour));
  const primaryCandidate = candidates.find((candidate) => !isDarkBrandColour(candidate.label, candidate.colour));
  const brandColor = primaryCandidate?.colour || candidates[0]?.colour || '#F1D64A';
  const backgroundColor = darkCandidate?.colour || '#0F172A';

  return {
    brandColor,
    brandColorHover: mixHex(brandColor, '#000000', 0.14),
    brandColorLight: mixHex(brandColor, '#FFFFFF', 0.82),
    backgroundColor,
  };
}

function getInitials(value: string): string {
  const initials = value
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  return initials || 'DD';
}

function buildGeneratedLogoSvg(branding: DemoBranchBranding): string {
  const initials = getInitials(branding.companyName);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="${escapeXml(branding.companyName)} logo">
  <rect width="512" height="512" rx="112" fill="${branding.backgroundColor}"/>
  <rect x="56" y="56" width="400" height="400" rx="88" fill="${branding.brandColor}"/>
  <text x="256" y="284" text-anchor="middle" fill="${branding.backgroundColor}" font-family="Arial, sans-serif" font-size="156" font-weight="800">${escapeXml(initials)}</text>
  <text x="256" y="352" text-anchor="middle" fill="${branding.backgroundColor}" font-family="Arial, sans-serif" font-size="34" font-weight="700">${escapeXml(branding.shortAppName)}</text>
</svg>
`;
}

async function writePngFromBuffer(buffer: ImageBuffer, outputPath: string, size: number): Promise<void> {
  const sharp = (await import('sharp')).default;
  await sharp(buffer)
    .resize({ width: size, height: size, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(outputPath);
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'DigiDocs demo personalisation asset fetcher',
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

function getTagAttribute(tag: string, attributeName: string): string | null {
  const match = tag.match(new RegExp(`${attributeName}\\s*=\\s*["']([^"']+)["']`, 'iu'));
  return match?.[1] || null;
}

function resolveCandidateUrl(value: string | null, baseUrl: string): string | null {
  if (!value || value.startsWith('data:')) {
    return null;
  }

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}

function getLogoCandidatesFromHtml(html: string, pageUrl: string): string[] {
  const candidates: string[] = [];
  const addCandidate = (value: string | null) => {
    const candidate = resolveCandidateUrl(value, pageUrl);
    if (candidate && !candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  };

  for (const match of html.matchAll(/<link\b[^>]*>/giu)) {
    const tag = match[0];
    const rel = getTagAttribute(tag, 'rel')?.toLowerCase() || '';
    if (rel.includes('icon')) {
      addCandidate(getTagAttribute(tag, 'href'));
    }
  }

  for (const match of html.matchAll(/<meta\b[^>]*>/giu)) {
    const tag = match[0];
    const property = getTagAttribute(tag, 'property')?.toLowerCase() || getTagAttribute(tag, 'name')?.toLowerCase() || '';
    if (property === 'og:image' || property === 'twitter:image') {
      addCandidate(getTagAttribute(tag, 'content'));
    }
  }

  for (const match of html.matchAll(/<img\b[^>]*>/giu)) {
    const tag = match[0];
    const descriptor = `${getTagAttribute(tag, 'alt') || ''} ${getTagAttribute(tag, 'class') || ''} ${getTagAttribute(tag, 'id') || ''}`;
    if (/logo|brand/iu.test(descriptor)) {
      addCandidate(getTagAttribute(tag, 'src') || getTagAttribute(tag, 'data-src'));
    }
  }

  return candidates;
}

async function fetchImageCandidate(candidateUrl: string): Promise<ImageBuffer | null> {
  try {
    const response = await fetchWithTimeout(candidateUrl);
    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get('content-type') || '';
    if (!/image\/(png|jpe?g|webp|svg\+xml|x-icon|vnd\.microsoft\.icon)/iu.test(contentType)) {
      return null;
    }

    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}

async function findWebsiteLogoBuffer(sourceUrl: string): Promise<{ buffer: ImageBuffer; sourceUrl: string } | null> {
  try {
    const response = await fetchWithTimeout(sourceUrl);
    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get('content-type') || '';
    if (/image\/(png|jpe?g|webp|svg\+xml)/iu.test(contentType)) {
      return { buffer: Buffer.from(await response.arrayBuffer()), sourceUrl };
    }

    if (!contentType.includes('text/html')) {
      return null;
    }

    const html = await response.text();
    for (const candidateUrl of getLogoCandidatesFromHtml(html, sourceUrl)) {
      const buffer = await fetchImageCandidate(candidateUrl);
      if (buffer) {
        return { buffer, sourceUrl: candidateUrl };
      }
    }
  } catch {
    return null;
  }

  return null;
}

async function writeBrandAssets(profile: ClientProfile, branding: DemoBranchBranding): Promise<BrandAssetResult> {
  const outputDirectory = path.join(REPO_ROOT, PUBLIC_GENERATED_ROOT, `submission-${profile.submission.submission_number}`);
  mkdirSync(outputDirectory, { recursive: true });

  const fallbackSvg = buildGeneratedLogoSvg(branding);
  const logoSvgPath = path.join(outputDirectory, 'logo.svg');
  const logoPngPath = path.join(outputDirectory, 'logo.png');
  const icon192Path = path.join(outputDirectory, 'icon-192x192.png');
  const icon512Path = path.join(outputDirectory, 'icon-512x512.png');
  const faviconPath = path.join(outputDirectory, 'favicon.svg');
  writeFileSync(logoSvgPath, fallbackSvg);
  writeFileSync(faviconPath, fallbackSvg);

  let logoBuffer: ImageBuffer = Buffer.from(fallbackSvg);
  let sourceUrl: string | null = null;
  let note = 'Generated a fallback logo from the submitted company name and brand colours.';
  const submittedAssetUrl = getStringAnswer(profile.answers, 'website_or_brand_assets');

  if (submittedAssetUrl) {
    const fetchedLogo = await findWebsiteLogoBuffer(submittedAssetUrl);
    if (fetchedLogo) {
      logoBuffer = fetchedLogo.buffer;
      sourceUrl = fetchedLogo.sourceUrl;
      note = `Fetched logo/brand asset from ${fetchedLogo.sourceUrl}.`;
    } else {
      sourceUrl = submittedAssetUrl;
      note = `Could not fetch a usable logo from ${submittedAssetUrl}; generated a fallback logo.`;
    }
  }

  try {
    await writePngFromBuffer(logoBuffer, logoPngPath, 512);
    await writePngFromBuffer(logoBuffer, icon192Path, 192);
    await writePngFromBuffer(logoBuffer, icon512Path, 512);
  } catch {
    const generatedBuffer = Buffer.from(fallbackSvg);
    await writePngFromBuffer(generatedBuffer, logoPngPath, 512);
    await writePngFromBuffer(generatedBuffer, icon192Path, 192);
    await writePngFromBuffer(generatedBuffer, icon512Path, 512);
    note = `${note} The fetched asset could not be converted to PNG, so generated logo files were used.`;
  }

  const publicPath = `/demo-personalisation/submission-${profile.submission.submission_number}`;
  return {
    logoPath: `${publicPath}/logo.png`,
    faviconPath: `${publicPath}/favicon.svg`,
    sourceUrl,
    note,
  };
}

function buildNavigationPriorityHrefs(answers: QuestionnaireAnswers): string[] {
  const hrefsByPriorityModule: Record<string, string[]> = {
    timesheets: ['/timesheets', '/approvals'],
    daily_checks: ['/van-inspections', '/plant-inspections', '/hgv-inspections'],
    fleet_maintenance: ['/fleet', '/maintenance'],
    workshop: ['/workshop-tasks'],
    projects_rams: ['/projects'],
    absence: ['/absence', '/absence/manage'],
    inventory: ['/inventory'],
    quotes_customers: ['/quotes', '/customers'],
    reports: ['/reports'],
  };
  const orderedHrefs = getStringArrayAnswer(answers, 'priority_modules').flatMap(
    (moduleId) => hrefsByPriorityModule[moduleId] || []
  );

  return Array.from(new Set(orderedHrefs));
}

function buildPdfConfig(profile: ClientProfile): DemoBranchPdf {
  const contactPhone = profile.submission.contact_phone?.trim();
  const contactLine = contactPhone
    ? `Telephone: ${contactPhone}`
    : `Email: ${profile.submission.contact_email}`;

  return {
    registeredOffice: `${profile.submission.company_name}, ${getStringAnswer(profile.answers, 'operating_region') || 'customer operating region'}`,
    contactLine,
    registrationLine: `Personalised demo output generated by ${profile.submission.company_name}`,
  };
}

async function buildDemoPersonalisation(profile: ClientProfile): Promise<DemoPersonalisation> {
  const colours = resolveBrandColours(profile.answers);
  const appNames = buildAppNames(profile);
  const baseBranding: DemoBranchBranding = {
    ...appNames,
    companyName: profile.submission.company_name,
    ...colours,
    logoPath: '/images/logo.svg',
    faviconPath: '/favicon.svg',
    sourceUrl: null,
  };
  const brandAssets = await writeBrandAssets(profile, baseBranding);

  return {
    branding: {
      ...baseBranding,
      logoPath: brandAssets.logoPath,
      faviconPath: brandAssets.faviconPath,
      sourceUrl: brandAssets.sourceUrl,
    },
    navigationPriorityHrefs: buildNavigationPriorityHrefs(profile.answers),
    pdf: buildPdfConfig(profile),
    assetNote: brandAssets.note,
  };
}

function getAnswerLabels(question: QuestionnaireQuestion, value: QuestionnaireAnswerValue): string | string[] {
  if (Array.isArray(value)) {
    return value.map((optionId) => getQuestionOptionLabel(question, optionId));
  }

  if (question.type === 'single_choice') {
    return getQuestionOptionLabel(question, value);
  }

  return value;
}

function isPlainObject(value: Json): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAnswerValue(value: Json): value is QuestionnaireAnswerValue {
  if (typeof value === 'string') {
    return true;
  }

  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function toQuestionnaireAnswers(value: Json): QuestionnaireAnswers {
  if (!isPlainObject(value)) {
    throw new Error('Submission answers are not a JSON object.');
  }

  return Object.fromEntries(
    Object.entries(value).filter(([, answerValue]) => isAnswerValue(answerValue))
  ) as QuestionnaireAnswers;
}

function buildReadableSections(answers: QuestionnaireAnswers): ReadableSection[] {
  const knownQuestionIds = new Set(questionnaireSections.flatMap((section) => section.questions.map((question) => question.id)));
  const sections = questionnaireSections
    .map((section) => ({
      sectionId: section.id,
      sectionTitle: section.title,
      answers: section.questions
        .flatMap((question) => {
          const value = answers[question.id];
          if (typeof value === 'undefined' || (typeof value === 'string' && value.trim().length === 0)) {
            return [];
          }

          return [
            {
              questionId: question.id,
              questionLabel: question.label,
              value: getAnswerLabels(question, value),
            },
          ];
        }),
    }))
    .filter((section) => section.answers.length > 0);

  const unknownAnswers = Object.entries(answers)
    .filter(([questionId]) => !knownQuestionIds.has(questionId))
    .map(([questionId, value]) => ({
      questionId,
      questionLabel: questionId,
      value,
    }));

  if (unknownAnswers.length > 0) {
    sections.push({
      sectionId: 'additional_answers',
      sectionTitle: 'Additional answers',
      answers: unknownAnswers,
    });
  }

  return sections;
}

function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/&/gu, ' and ')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 54)
    .replace(/-+$/gu, '');

  return slug || 'client';
}

function formatValue(value: string | string[]): string {
  if (Array.isArray(value)) {
    return value.join(', ');
  }

  return value;
}

function markdownValue(value: string | string[]): string {
  return formatValue(value).replace(/\r?\n/gu, '\n  ');
}

function buildRecommendedChanges(profile: ClientProfile): string[] {
  const answers = profile.answers;
  const recommendations = [
    'Keep using the shared fictional sample database unless this prospect needs a deeper private demo dataset.',
  ];

  if (getStringAnswer(answers, 'example_work')) {
    recommendations.push('Use the supplied example projects/jobs/sites to guide future demo seed-data changes.');
  }

  return recommendations;
}

function buildConfigFile(profile: ClientProfile, personalisation: DemoPersonalisation): string {
  return `export interface DemoBranchConfig {
  enabled: boolean;
  submissionNumber: number | null;
  companyName: string | null;
  contactName: string | null;
  branchName: string | null;
  generatedAt: string | null;
  branding: DemoBranchBrandingConfig | null;
  navigationPriorityHrefs: string[];
  pdf: DemoBranchPdfConfig | null;
}

export interface DemoBranchBrandingConfig {
  appName: string;
  shortAppName: string;
  companyName: string;
  brandColor: string;
  brandColorHover: string;
  brandColorLight: string;
  backgroundColor: string;
  logoPath: string;
  faviconPath: string;
  sourceUrl: string | null;
}

export interface DemoBranchPdfConfig {
  registeredOffice: string;
  contactLine: string;
  registrationLine: string;
}

export const demoBranchConfig: DemoBranchConfig = {
  enabled: true,
  submissionNumber: ${profile.submission.submission_number},
  companyName: ${JSON.stringify(profile.submission.company_name)},
  contactName: ${JSON.stringify(profile.submission.contact_name)},
  branchName: ${JSON.stringify(profile.branchName)},
  generatedAt: ${JSON.stringify(profile.generatedAt)},
  branding: ${JSON.stringify(personalisation.branding, null, 2)},
  navigationPriorityHrefs: ${JSON.stringify(personalisation.navigationPriorityHrefs, null, 2)},
  pdf: ${JSON.stringify(personalisation.pdf, null, 2)},
};
`;
}

function buildManifestFile(personalisation: DemoPersonalisation): string {
  return `${JSON.stringify(
    {
      name: personalisation.branding.appName,
      short_name: personalisation.branding.shortAppName,
      description: `${personalisation.branding.companyName} digital field operations demo`,
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: personalisation.branding.backgroundColor,
      theme_color: personalisation.branding.brandColor,
      orientation: 'portrait-primary',
      icons: [
        {
          src: personalisation.branding.logoPath.replace(/logo\.png$/u, 'icon-192x192.png'),
          sizes: '192x192',
          type: 'image/png',
          purpose: 'any maskable',
        },
        {
          src: personalisation.branding.logoPath.replace(/logo\.png$/u, 'icon-512x512.png'),
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any maskable',
        },
      ],
      shortcuts: [],
      categories: ['business', 'productivity'],
      screenshots: [],
    },
    null,
    2
  )}\n`;
}

function buildBrief(profile: ClientProfile, personalisation: DemoPersonalisation): string {
  const recommendations = buildRecommendedChanges(profile)
    .map((recommendation) => `- ${recommendation}`)
    .join('\n');

  const answersMarkdown = profile.readableSections
    .map((section) => {
      const answers = section.answers
        .map((answer) => `- **${answer.questionLabel}**: ${markdownValue(answer.value)}`)
        .join('\n');

      return `### ${section.sectionTitle}\n${answers}`;
    })
    .join('\n\n');

  return `# Demo Personalisation Brief: ${profile.submission.company_name}

Generated from questionnaire submission #${profile.submission.submission_number} on ${profile.generatedAt}.

## Branch
- Branch: \`${profile.branchName}\`
- Contact: ${profile.submission.contact_name} <${profile.submission.contact_email}>
- Phone: ${profile.submission.contact_phone || 'Not provided'}
- Submitted: ${profile.submission.created_at}

## Important Demo Data Note
This personalised branch uses the shared fictional sample database. Names, records, vehicles, documents, and activity inside the app are demo data only.

## Deterministic Changes Applied
- Enabled the demo branch notice for ${profile.submission.company_name}.
- Changed the app name to ${personalisation.branding.appName}.
- Applied brand colours: primary ${personalisation.branding.brandColor}, background ${personalisation.branding.backgroundColor}.
- Updated logo, favicon, and PWA manifest assets. ${personalisation.assetNote}
- Reordered navigation priorities: ${personalisation.navigationPriorityHrefs.length > 0 ? personalisation.navigationPriorityHrefs.join(', ') : 'No priority modules selected'}.
- Personalised timesheet and inspection/defect PDF headers with the customer company, contact line, and brand colour.
- Generated this branch-local personalisation brief.
- Stored a redacted operational submission export beside this brief.

## Recommended Follow-Up Changes
${recommendations}

## Questionnaire Answers
${answersMarkdown}

## Optional Deeper Personalisation Checklist
- Review \`lib/config/template-config.ts\` for app/company naming and demo persona copy.
- Review \`scripts/demo/seed.ts\` if fictional teams, users, assets, projects, or customers should be made more relevant.
- Review \`lib/config/navigation.ts\` and \`lib/config/forms.ts\` if module labels need prospect-specific wording.
- Review public logo, favicon, and \`public/manifest.json\` if a stronger branded preview is needed.
- Review PDF/email surfaces for requested output personalisation.
`;
}

function buildSubmissionExport(profile: ClientProfile, personalisation: DemoPersonalisation): string {
  return JSON.stringify(
    {
      submissionNumber: profile.submission.submission_number,
      id: profile.submission.id,
      companyName: profile.submission.company_name,
      contactName: profile.submission.contact_name,
      contactEmail: profile.submission.contact_email,
      contactPhone: profile.submission.contact_phone,
      createdAt: profile.submission.created_at,
      branchName: profile.branchName,
      generatedAt: profile.generatedAt,
      personalisation,
      answers: profile.answers,
      readableSections: profile.readableSections,
    },
    null,
    2
  );
}

async function fetchSubmission(submissionNumber: number): Promise<SubmissionRow> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to read questionnaire submissions.');
  }

  const supabase = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data, error } = await supabase
    .from('questionnaire_submissions')
    .select('*')
    .eq('submission_number', submissionNumber)
    .single();

  if (error || !data) {
    throw new Error(`Unable to find questionnaire submission #${submissionNumber}: ${error?.message || 'not found'}`);
  }

  return data;
}

function buildClientProfile(submission: SubmissionRow): ClientProfile {
  const answers = toQuestionnaireAnswers(submission.answers);
  const branchSlug = slugify(submission.company_name);
  const branchName = `demo/${branchSlug}-submission-${submission.submission_number}`;

  return {
    submission,
    answers,
    readableSections: buildReadableSections(answers),
    branchName,
    generatedAt: new Date().toISOString(),
  };
}

async function writeGeneratedFiles(profile: ClientProfile): Promise<void> {
  const personalisation = await buildDemoPersonalisation(profile);
  const outputDirectory = path.join(REPO_ROOT, GENERATED_ROOT, `submission-${profile.submission.submission_number}`);
  mkdirSync(outputDirectory, { recursive: true });

  writeFileSync(path.join(REPO_ROOT, DEMO_BRANCH_CONFIG_PATH), buildConfigFile(profile, personalisation));
  writeFileSync(path.join(REPO_ROOT, MANIFEST_PATH), buildManifestFile(personalisation));
  writeFileSync(path.join(outputDirectory, 'brief.md'), buildBrief(profile, personalisation));
  writeFileSync(path.join(outputDirectory, 'submission.json'), `${buildSubmissionExport(profile, personalisation)}\n`);
}

async function createBranch(profile: ClientProfile, options: Options): Promise<void> {
  assertCleanWorkingTree();
  assertBranchAvailable(profile.branchName);

  const currentBranch = getCurrentBranch();
  if (currentBranch !== options.baseBranch) {
    runCommand('git', ['switch', options.baseBranch]);
  }

  runCommand('git', ['switch', '-c', profile.branchName]);
  await writeGeneratedFiles(profile);

  const status = runCommand('git', ['status', '--porcelain'], true).stdout.trim();
  if (!status) {
    throw new Error('No generated changes were created for the demo branch.');
  }

  runCommand('git', [
    'add',
    DEMO_BRANCH_CONFIG_PATH,
    MANIFEST_PATH,
    path.join(GENERATED_ROOT, `submission-${profile.submission.submission_number}`),
    path.join(PUBLIC_GENERATED_ROOT, `submission-${profile.submission.submission_number}`),
  ]);
  runCommand('git', ['commit', '-m', `chore(demo): prepare ${profile.submission.company_name} demo branch`]);

  if (options.push) {
    runCommand('git', ['push', '-u', 'origin', 'HEAD']);
  }
}

function printDryRun(profile: ClientProfile, options: Options): void {
  console.log(`Submission: #${profile.submission.submission_number}`);
  console.log(`Company: ${profile.submission.company_name}`);
  console.log(`Contact: ${profile.submission.contact_name} <${profile.submission.contact_email}>`);
  console.log(`Branch: ${profile.branchName}`);
  console.log(`Base: ${options.baseBranch}`);
  console.log(`Push: ${options.push ? 'yes' : 'no'}`);
  console.log('');
  console.log('Dry run only. No files, branches, commits, or pushes were created.');
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  assertValidOptions(options);

  if (options.help) {
    printUsage();
    return;
  }

  const submission = await fetchSubmission(options.submissionNumber);
  const profile = buildClientProfile(submission);

  if (options.dryRun) {
    printDryRun(profile, options);
    return;
  }

  await createBranch(profile, options);

  console.log('Demo branch created.');
  console.log(`- Branch: ${profile.branchName}`);
  console.log(`- Submission: #${profile.submission.submission_number}`);
  console.log(`- Company: ${profile.submission.company_name}`);
  console.log(`- Pushed: ${options.push ? 'yes' : 'no'}`);
  if (!options.push) {
    console.log(`Next: git push -u origin ${profile.branchName}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
