import { defineConfig, devices } from '@playwright/test'

// e2e runs on its own port (not Vite's default 5173) so reuseExistingServer
// can only ever reuse an e2e server started from THIS checkout — never a dev
// server left running in another checkout/worktree that serves stale code.
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
