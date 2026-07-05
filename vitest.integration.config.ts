import { defineConfig } from "vitest/config";

// Separate from vitest.config.ts on purpose: spins up a real MariaDB via
// testcontainers (container pull + boot can take a while), so it needs a
// longer timeout and must never run as part of plain `npm test` — only via
// `npm run test:integration`.
export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
