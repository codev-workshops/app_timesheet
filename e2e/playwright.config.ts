import { defineConfig, devices } from '@playwright/test';

const BACKEND_PORT = 3001;
const FRONTEND_PORT = 5173;

export const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;
export const FRONTEND_URL = `http://localhost:${FRONTEND_PORT}`;

// Set E2E_REUSE_SERVERS=1 to run against dev servers you already started.
const reuseExistingServer = process.env.E2E_REUSE_SERVERS === '1';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  use: {
    baseURL: FRONTEND_URL,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'npm run dev',
      cwd: '../backend',
      url: `${BACKEND_URL}/health`,
      reuseExistingServer,
      env: { PORT: String(BACKEND_PORT), NODE_ENV: 'development' },
      timeout: 60_000,
    },
    {
      command: 'npm run dev',
      cwd: '../frontend',
      url: FRONTEND_URL,
      reuseExistingServer,
      timeout: 60_000,
    },
  ],
});
