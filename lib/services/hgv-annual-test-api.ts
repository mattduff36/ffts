import { logger } from '@/lib/utils/logger';

interface HgvAnnualTestConfig {
  baseUrl: string;
  apiKey: string;
  registrationPath: string;
  acceptHeader: string;
}

interface AnnualTestRecord {
  completedDate?: string | null;
  testDate?: string | null;
  testResult?: string | null;
  result?: string | null;
  expiryDate?: string | null;
  testExpiryDate?: string | null;
  annualTestExpiryDate?: string | null;
  certificateExpiryDate?: string | null;
  motTestNumber?: string | number | null;
}

interface AnnualTestResponse {
  registration?: string | null;
  vrm?: string | null;
  regNumber?: string | null;
  make?: string | null;
  model?: string | null;
  annualTestExpiryDate?: string | null;
  annualTestDueDate?: string | null;
  testExpiryDate?: string | null;
  certificateExpiryDate?: string | null;
  motTestDueDate?: string | null;
  tests?: AnnualTestRecord[];
  annualTests?: AnnualTestRecord[];
  motTests?: AnnualTestRecord[];
  [key: string]: unknown;
}

export interface HgvAnnualTestExpiryData {
  registration: string;
  motExpiryDate: string | null;
  motStatus: string;
  lastTestDate: string | null;
  lastTestResult: string | null;
  rawData: AnnualTestResponse;
}

const DEFAULT_REGISTRATION_PATH = '/trade/vehicles/annual-tests?registration={registration}';
const DEFAULT_ACCEPT_HEADER = 'application/json';
const PASS_RESULTS = new Set(['PASSED', 'PASS', 'PRS']);

function cleanRegistration(registration: string): string {
  return registration.replace(/\s+/g, '').toUpperCase();
}

function buildUrl(config: HgvAnnualTestConfig, registration: string): string {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const path = config.registrationPath.startsWith('/')
    ? config.registrationPath
    : `/${config.registrationPath}`;
  return `${baseUrl}${path.replace('{registration}', encodeURIComponent(registration))}`;
}

function normalizeDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().replace(/\./g, '-');
  const dateOnly = normalized.split(/[T ]/)[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null;
  return dateOnly;
}

function getTestDate(test: AnnualTestRecord): string | null {
  return normalizeDate(test.completedDate) || normalizeDate(test.testDate);
}

function getTestExpiryDate(test: AnnualTestRecord): string | null {
  return (
    normalizeDate(test.expiryDate) ||
    normalizeDate(test.testExpiryDate) ||
    normalizeDate(test.annualTestExpiryDate) ||
    normalizeDate(test.certificateExpiryDate)
  );
}

function getTestResult(test: AnnualTestRecord): string | null {
  return test.testResult || test.result || null;
}

function getAnnualTests(rawData: AnnualTestResponse): AnnualTestRecord[] {
  if (Array.isArray(rawData.annualTests)) return rawData.annualTests;
  if (Array.isArray(rawData.tests)) return rawData.tests;
  if (Array.isArray(rawData.motTests)) return rawData.motTests;
  return [];
}

function getTopLevelExpiryDate(rawData: AnnualTestResponse): string | null {
  return (
    normalizeDate(rawData.annualTestExpiryDate) ||
    normalizeDate(rawData.annualTestDueDate) ||
    normalizeDate(rawData.testExpiryDate) ||
    normalizeDate(rawData.certificateExpiryDate) ||
    normalizeDate(rawData.motTestDueDate)
  );
}

function getMostRecentPassedTest(tests: AnnualTestRecord[]): AnnualTestRecord | null {
  return tests
    .filter((test) => {
      const result = getTestResult(test);
      return result ? PASS_RESULTS.has(result.toUpperCase()) : Boolean(getTestExpiryDate(test));
    })
    .sort((a, b) => (getTestDate(b) || '').localeCompare(getTestDate(a) || ''))[0] || null;
}

function getMotStatus(expiryDate: string | null): string {
  if (!expiryDate) return 'No Annual Test Expiry Date';
  const expiryTimestamp = new Date(expiryDate).getTime();
  return expiryTimestamp > Date.now() ? 'Valid' : 'Expired';
}

export class HgvAnnualTestService {
  private readonly config: HgvAnnualTestConfig;
  private readonly requestTimeoutMs = 15_000;

  constructor(config: HgvAnnualTestConfig) {
    this.config = config;
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    return fetch(url, {
      method: 'GET',
      headers: {
        Accept: this.config.acceptHeader,
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
      },
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
  }

  async getMotExpiryData(registration: string): Promise<HgvAnnualTestExpiryData> {
    const cleanReg = cleanRegistration(registration);
    const url = buildUrl(this.config, cleanReg);

    logger.info(`Fetching HGV annual test history for ${cleanReg}`);

    const response = await this.fetchWithTimeout(url);
    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 404) {
        throw new Error(`No HGV annual test history found for ${cleanReg}`);
      }
      if (response.status === 429) {
        throw new Error('HGV annual test API rate limit exceeded');
      }
      throw new Error(`HGV annual test API request failed: ${response.status} - ${errorText}`);
    }

    const payload = await response.json();
    const rawData = (Array.isArray(payload) ? payload[0] : payload) as AnnualTestResponse | undefined;
    if (!rawData) {
      throw new Error(`No HGV annual test history found for ${cleanReg}`);
    }

    const tests = getAnnualTests(rawData);
    const latestTest = [...tests].sort((a, b) => (getTestDate(b) || '').localeCompare(getTestDate(a) || ''))[0] || null;
    const latestPassedTest = getMostRecentPassedTest(tests);
    const expiryDate = getTestExpiryDate(latestPassedTest || {}) || getTopLevelExpiryDate(rawData);
    const lastTestResult = latestPassedTest ? getTestResult(latestPassedTest) : latestTest ? getTestResult(latestTest) : null;

    return {
      registration: rawData.registration || rawData.vrm || rawData.regNumber || cleanReg,
      motExpiryDate: expiryDate,
      motStatus: getMotStatus(expiryDate),
      lastTestDate: latestTest ? getTestDate(latestTest) : null,
      lastTestResult,
      rawData,
    };
  }
}

export function createHgvAnnualTestService(): HgvAnnualTestService | null {
  const baseUrl = process.env.HGV_ANNUAL_TEST_API_BASE_URL;
  const apiKey = process.env.HGV_ANNUAL_TEST_API_KEY;

  if (!baseUrl || !apiKey) {
    logger.warn('HGV annual test API credentials not configured');
    return null;
  }

  return new HgvAnnualTestService({
    baseUrl,
    apiKey,
    registrationPath: process.env.HGV_ANNUAL_TEST_API_REGISTRATION_PATH || DEFAULT_REGISTRATION_PATH,
    acceptHeader: process.env.HGV_ANNUAL_TEST_API_ACCEPT || DEFAULT_ACCEPT_HEADER,
  });
}
