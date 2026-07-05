import express from "express";
import { customPermissionGuard, pool } from "./custom-permission-guard.service.js";
import { summarize } from "../../shared/proof.js";
import { runScenarios } from "../../shared/scenarios.js";
import { waitForDatabase } from "../../shared/sql-data.js";

// Proves the Express wiring is real (a genuine dependency, genuinely
// constructed) — no routes are opened and .listen() is never called, per
// the POC's brief: prove the library through direct calls, not HTTP.
const app = express();
void app;

async function main() {
  await waitForDatabase(pool);
  await runScenarios(customPermissionGuard, pool, "multiple");
  await pool.end();
  summarize("express-multiple");
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
