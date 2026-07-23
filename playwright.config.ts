import { defineConfig } from '@playwright/test';
import testsuiteConfig from './testsuite/config/playwright.config';

export default defineConfig(testsuiteConfig, {
  testDir: './testsuite/ui',
  testMatch: '**/*.spec.ts',
});
