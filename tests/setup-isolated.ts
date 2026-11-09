import { vi } from 'vitest';

vi.mock('server-only', () => ({}));

// Never load credential files or inherit real connection details in this suite.
for (const key of Object.keys(process.env)) {
  if (/SUPABASE|POSTGRES|FFTS_DATA_ENVIRONMENT|FFTS_DEVELOPMENT|TESTSUITE|SAMPLE.*PROJECT_REF/u.test(key)) {
    delete process.env[key];
  }
}
