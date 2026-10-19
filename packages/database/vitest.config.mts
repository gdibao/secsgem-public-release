import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    {
      name: 'raw-md',
      transform(_, id) {
        if (id.endsWith('.md')) return { code: 'export default ""', map: null };
      },
    },
  ],
  optimizeDeps: {
    exclude: ['crypto', 'util', 'tty'],
    include: ['@lobehub/tts'],
  },
  test: {
    alias: {
      '@/const': path.resolve(__dirname, '../const/src'),
      '@/utils/errorResponse': path.resolve(__dirname, '../../src/utils/errorResponse'),
      '@/utils': path.resolve(__dirname, '../utils/src'),
      '@/database': path.resolve(__dirname, '../database/src'),
      '@/libs/model-runtime': path.resolve(__dirname, '../model-runtime/src'),
      '@/types': path.resolve(__dirname, '../types/src'),
      '@/config': path.resolve(__dirname, '../app-config/src'),
      '@/envs': path.resolve(__dirname, '../env/src'),
      '@/libs/trpc': path.resolve(__dirname, '../trpc/src'),
      '@/locales': path.resolve(__dirname, '../locales/src'),
      '@/business/server': path.resolve(__dirname, '../business-server/src'),
      '@/server/services': path.resolve(__dirname, '../../apps/server/src/services'),
      '@/server/modules': path.resolve(__dirname, '../../apps/server/src/modules'),
      '@': path.resolve(__dirname, '../../src'),
    },
    coverage: {
      exclude: [
        'src/server/**',
        'src/repositories/dataImporter/deprecated/**',
        'src/types/**',
        'src/models/userMemory/sources/index.ts',
        'src/models/userMemory/sources/shared.ts',
        'src/models/ragEval/index.ts',
        'src/models/agentEval/index.ts',
        'src/repositories/userMemory/index.ts',
        'src/models/_template.ts',
        'src/models/__tests__/_test_template.ts',
        'src/models/web-server.ts',
        'src/core/web-server.ts',
        'src/core/db-adaptor.ts',
        'src/core/getTestDB.ts',
        'src/index.ts',
        'tests/**',
        'vitest.config*.mts',
      ],
      reporter: ['text', 'json'],
    },
    environment: 'happy-dom',
    exclude: [
      'node_modules/**/**',
      'src/server/**/**',
      'src/repositories/dataImporter/deprecated/**/**',
    ],
    server: {
      deps: {
        inline: ['vitest-canvas-mock'],
      },
    },
    setupFiles: path.resolve(__dirname, 'tests/setup-db.ts'),
  },
});
