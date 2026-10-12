import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 15_000,
    // Forces the same branch the app takes in CI: no HTTP logging, no rate limits.
    env: { NODE_ENV: 'test' },
  },
})
