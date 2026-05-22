import { defineConfig, devices } from '@playwright/test'

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(dirname, '.env') })
const PORT = process.env.CI ? '8081' : process.env.PORT || '8080'
/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 1 : 0,
  /* Opt out of parallel tests on CI. */
  workers: 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [['html', { open: 'never' }]],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('')`. */
    baseURL: `http://localhost:${PORT}`,

    /* Collect trace when a test fails. See https://playwright.dev/docs/trace-viewer */
    trace: 'retain-on-failure',
    screenshot: 'on',
    video: 'on',
  },

  projects: [
    {
      name: 'Google Chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
    {
      name: 'embedding-service',
      testMatch: /tests\/services\/embedding\/.*\.spec\.ts/,
    },
    {
      name: 'vectordb-service',
      testMatch: /tests\/services\/vectordb\/.*\.spec\.ts/,
      // This project will NOT start until 'embedding-service' finishes
      dependencies: ['embedding-service'],
    },
    {
      name: 'other-tests',
      testIgnore: [/tests\/services\/embedding/, /tests\/services\/vectordb/],
    },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    env: { PORT },
    command: 'npm run start',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 120 * 1000,
  },
})
