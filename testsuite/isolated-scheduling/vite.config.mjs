import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const local = (path) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  root: local('./'),
  envDir: local('./'),
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@/components/providers/NuqsClientAdapter', replacement: local('./stubs.tsx') },
      { find: '@/lib/hooks/usePermissionCheck', replacement: local('./stubs.tsx') },
      { find: '@/lib/hooks/useAuth', replacement: local('./stubs.tsx') },
      { find: '@/lib/hooks/usePermissionSnapshot', replacement: local('./stubs.tsx') },
      { find: '@/lib/hooks/useNavMetrics', replacement: local('./stubs.tsx') },
      { find: '@/components/layout/tablet-mode-context', replacement: local('./stubs.tsx') },
      { find: 'next/navigation', replacement: local('./stubs.tsx') },
      { find: 'next/link', replacement: local('./link.tsx') },
      { find: 'next/dynamic', replacement: local('./dynamic.tsx') },
      { find: '@', replacement: local('../../') },
    ],
  },
  server: { host: '127.0.0.1', port: 4017, strictPort: true, fs: { allow: [local('../../')] } },
});
