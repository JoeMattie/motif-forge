import { defineConfig, devices } from '@playwright/test'

// e2e runs on its own dedicated port, NOT the interactive dev port 5173:
// reuseExistingServer on 5173 can silently run the suite against a DIFFERENT
// checkout's code (e.g. a git worktree's e2e run picking up a dev server
// started from the main checkout). --strictPort makes a port collision fail
// loudly instead of vite drifting to another port the suite isn't watching.
const PORT = 5187

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
})
