import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'real-backend.spec.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4174 --strictPort',
    port: 4174,
    reuseExistingServer: false,
    env: {
      VITE_API_PROXY_TARGET: 'http://127.0.0.1:8001',
      VITE_DEMO_MODE: 'true',
    },
  },
});
