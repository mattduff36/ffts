import { createHash } from 'crypto';
import { redactSensitiveText } from './logger';

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu;
const TRANSCRIPT_PATH_PATTERN = /agent-transcripts/iu;
const ENV_ASSIGNMENT_PATTERN =
  /\b(?:POSTGRES_URL(?:_NON_POOLING)?|SUPABASE_(?:SERVICE_ROLE_KEY|ANON_KEY)|[A-Z0-9_]*(?:API|ACCESS|SECRET|PRIVATE|REFRESH|CLIENT)[_-]?KEY[A-Z0-9_]*|[A-Z0-9_]*(?:PASSWORD|TOKEN|SECRET)[A-Z0-9_]*)\s*[:=]\s*\S+/iu;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/iu;
const PRIVATE_KEY_PATTERN =
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/iu;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/u;
const GENERIC_SECRET_ASSIGNMENT_PATTERN =
  /(?:^|[^A-Za-z0-9])(?:password|passwd|token|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|service[_-]?role[_-]?key|private[_-]?key)\s*[:=]\s*["']?[^"',\s]{8,}/iu;
const JSON_SECRET_KEY_PATTERN =
  /"(?:access_token|refresh_token|client_secret|api_key|private_key|password|token|secret)"\s*:\s*"[^"]{8,}"/iu;

export function hashIdentifier(value: string | null | undefined): string {
  const normalized = typeof value === 'string' && value.trim() ? value.trim() : 'unavailable';
  return createHash('sha256').update(normalized).digest('hex').slice(0, 32);
}

export function sanitizeEvidenceLabel(label: string): string {
  return redactSensitiveText(label)
    .replace(EMAIL_PATTERN, '[REDACTED_EMAIL]')
    .replace(/[A-Za-z]:\\[^\s"']+/gu, '[REDACTED_PATH]')
    .replace(/\/(?:Users|home)\/[^\s"']+/gu, '[REDACTED_PATH]')
    .replace(/agent-transcripts[^\s"']*/giu, '[REDACTED_TRANSCRIPT_REF]')
    .replace(BEARER_PATTERN, 'Bearer [REDACTED]')
    .replace(PRIVATE_KEY_PATTERN, '[REDACTED_PRIVATE_KEY]')
    .replace(JWT_PATTERN, '[REDACTED_JWT]')
    .replace(ENV_ASSIGNMENT_PATTERN, '[REDACTED_ENV]')
    .replace(GENERIC_SECRET_ASSIGNMENT_PATTERN, '[REDACTED_SECRET]')
    .replace(JSON_SECRET_KEY_PATTERN, '"[REDACTED_SECRET_KEY]":"[REDACTED]"');
}

const ABSOLUTE_PRIVATE_PATH_PATTERN =
  /(?:[A-Za-z]:\\{1,2}(?:Users|home)\\{1,2}[^\s"']+|\/(?:Users|home)\/[^\s"']+)/iu;

export function assertNoForbiddenPayload(payload: unknown): string[] {
  const serialized = JSON.stringify(payload);
  const violations: string[] = [];
  if (/"user_email"\s*:/u.test(serialized)) violations.push('user_email must not be persisted');
  if (TRANSCRIPT_PATH_PATTERN.test(serialized)) {
    violations.push('raw transcript path must not be persisted');
  }
  if (EMAIL_PATTERN.test(serialized)) {
    violations.push('email address must not be persisted');
  }
  if (BEARER_PATTERN.test(serialized)) {
    violations.push('bearer token must not be persisted');
  }
  if (PRIVATE_KEY_PATTERN.test(serialized)) {
    violations.push('private key material must not be persisted');
  }
  if (JWT_PATTERN.test(serialized)) {
    violations.push('JWT token must not be persisted');
  }
  if (ENV_ASSIGNMENT_PATTERN.test(serialized)) {
    violations.push('environment secret assignment must not be persisted');
  }
  if (GENERIC_SECRET_ASSIGNMENT_PATTERN.test(serialized)) {
    violations.push('secret assignment must not be persisted');
  }
  if (JSON_SECRET_KEY_PATTERN.test(serialized)) {
    violations.push('secret assignment must not be persisted');
  }
  if (ABSOLUTE_PRIVATE_PATH_PATTERN.test(serialized)) {
    violations.push('absolute private path must not be persisted');
  }
  return violations;
}
