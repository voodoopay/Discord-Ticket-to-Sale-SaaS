import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      '@voodoo/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      next: fileURLToPath(new URL('../web-app/node_modules/next', import.meta.url)),
      'next/server': fileURLToPath(new URL('../web-app/node_modules/next/server.js', import.meta.url)),
      'next/headers': fileURLToPath(
        new URL('../web-app/node_modules/next/headers.js', import.meta.url),
      ),
    },
  },
  test: {
    execArgv: ['--disable-warning=DEP0040'],
    environment: 'node',
    include: ['app/**/*.test.ts', 'lib/**/*.test.ts'],
  },
});
