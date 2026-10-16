import { defineConfig } from '@playwright/test'

// One browser smoke test of the main path, against the built app with the API
// faked from recorded responses (tests/e2e/api-fixtures.json) — no backend, no
// Ollama, so it runs on any machine with nothing else started.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  webServer: {
    command: 'pnpm build && pnpm exec vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 180_000,
  },
})
