const { defineConfig, devices } = require('@playwright/test');

const PORT = 3100;

module.exports = defineConfig({
  testDir: 'tests/e2e',
  // All specs share one in-memory database.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node tests/dev-server.js',
    // In memory, and without .env, so tests never touch real data.
    env: { PORT: String(PORT), LOCAL_DB_DIR: 'memory', DATABASE_URL: '', GROQ_API_KEY: '', GMAIL_USER: '', E2E_MAIL: '1' },
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI
  }
});
