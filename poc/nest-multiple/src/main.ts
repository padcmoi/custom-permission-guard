import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { CustomPermissionGuardService } from "./custom-permission-guard/custom-permission-guard.service.js";
import { summarize } from "../../shared/proof.js";
import { runScenarios } from "../../shared/scenarios.js";
import { waitForDatabase } from "../../shared/sql-data.js";

async function main() {
  // DI container only — no HTTP adapter, no port, no routes opened, per the
  // POC's brief: prove the library through direct calls, not HTTP.
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const service = app.get(CustomPermissionGuardService);

  await waitForDatabase(service.pool);
  await runScenarios(service.guard, service.pool, "multiple");

  await service.pool.end();
  await app.close();
  summarize("nest-multiple");
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
