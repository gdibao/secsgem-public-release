import path from 'node:path';

import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths({ projects: [path.resolve(__dirname, '../../tsconfig.json')] })],
  test: {
    alias: {
      '@/business/server': path.resolve(__dirname, '../../packages/business-server/src'),
      '@/business': path.resolve(__dirname, '../../src/business'),
      '@/config': path.resolve(__dirname, '../../packages/app-config/src'),
      '@/const/aboutLinks': path.resolve(__dirname, '../../src/const/aboutLinks.ts'),
      '@/const/avatarPresets': path.resolve(__dirname, '../../src/const/avatarPresets.ts'),
      '@/const/brand': path.resolve(__dirname, '../../src/const/brand.ts'),
      '@/const/defaultAgent': path.resolve(__dirname, '../../packages/const/src/defaultAgent.ts'),
      '@/const/expertPlaza': path.resolve(__dirname, '../../src/const/expertPlaza.ts'),
      '@/database': path.resolve(__dirname, '../../packages/database/src'),
      '@/envs': path.resolve(__dirname, '../../packages/env/src'),
      '@/libs/trpc': path.resolve(__dirname, '../../packages/trpc/src'),
      '@/server/globalConfig': path.resolve(__dirname, '../../apps/server/src/globalConfig'),
      '@/server/modules': path.resolve(__dirname, '../../apps/server/src/modules'),
      '@/server/services/document': path.resolve(
        __dirname,
        '../../apps/server/src/services/document',
      ),
      '@/server/services/desktopBuild/assets': path.resolve(
        __dirname,
        '../../apps/server/src/services/desktopBuild/assets.ts',
      ),
      '@/server/services/desktopRelease': path.resolve(
        __dirname,
        '../../apps/server/src/services/desktopRelease',
      ),
      '@/server/services/file': path.resolve(__dirname, '../../apps/server/src/services/file'),
      '@/server/services/moduleAppRuntime': path.resolve(
        __dirname,
        '../../apps/server/src/services/moduleAppRuntime',
      ),
      '@/server/routers': path.resolve(__dirname, '../../apps/server/src/routers'),
      '@/server': path.resolve(__dirname, '../../src/server'),
      '@/types': path.resolve(__dirname, '../../packages/types/src'),
      '@/utils': path.resolve(__dirname, '../../src/utils'),
      '@': path.resolve(__dirname, '../../src'),
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'lcov', 'text-summary'],
    },
    environment: 'node',
  },
});
