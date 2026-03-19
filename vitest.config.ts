import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@voodoo/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: [
      'packages/core/tests/**/*.test.ts',
      'apps/web-app/**/*.test.ts',
      'apps/bot-worker/**/*.test.ts',
      'apps/join-gate-worker/**/*.test.ts',
      'apps/nuke-worker/**/*.test.ts',
      'apps/telegram-worker/**/*.test.ts',
    ],
    environment: 'node',
    coverage: {
      provider: 'v8',
      // Keep the enforced coverage gate on deterministic unit-test surfaces.
      // Discord runtimes, Next.js routes, repositories, and other IO shells are
      // validated by behavior tests but are not treated as line-coverage targets.
      include: [
        'packages/core/src/services/join-gate-service.ts',
        'packages/core/src/services/coupon-scope.ts',
        'packages/core/src/services/nuke-schedule.ts',
        'packages/core/src/services/order-source.ts',
        'packages/core/src/services/points-calculator.ts',
        'packages/core/src/utils/mask.ts',
        'packages/core/src/utils/platform-ids.ts',
        'apps/web-app/lib/checkout-launch.ts',
        'apps/web-app/lib/checkout-redirect.ts',
        'apps/web-app/lib/dashboard-layout.ts',
        'apps/web-app/lib/dashboard-panels.ts',
        'apps/telegram-worker/src/lib/checkout-links.ts',
        'apps/telegram-worker/src/lib/referral-submission-log.ts',
        'apps/telegram-worker/src/lib/sale-links.ts',
      ],
      reporter: ['text', 'lcov'],
      thresholds: {
        statements: 95,
        branches: 85,
        functions: 95,
        lines: 95,
      },
    },
  },
});
