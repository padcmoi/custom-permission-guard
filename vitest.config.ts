import { defineConfig } from "vitest/config";

// Scoped to unit tests only: the immutable .github/workflows/publish.yml
// calls bare `npm test` (= `vitest run` with no args), which must never
// reach for a database. Integration tests live in test/integration and run
// only via `npm run test:integration` (see vitest.integration.config.ts).
export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts"],
  },
});
