// tests/setup.ts
import { vi } from 'vitest';
import { config } from 'dotenv';
import { resolve } from 'path';

vi.mock('server-only', () => ({}));

// Load .env.local for tests
config({ path: resolve(process.cwd(), '.env.local') });
