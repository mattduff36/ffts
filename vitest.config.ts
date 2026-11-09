import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  envDir: false,
  plugins: [react()],
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'app/**/*.{ts,tsx}',
        'lib/**/*.{ts,tsx}',
        'components/**/*.{ts,tsx}',
      ],
      exclude: [
        '**/*.d.ts',
        '**/*.config.*',
        '**/node_modules/**',
        '**/dist/**',
        '**/.next/**',
        '**/tests/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
