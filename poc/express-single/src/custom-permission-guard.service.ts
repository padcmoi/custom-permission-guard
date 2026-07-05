// Reserved for this lib: reads env here (service layer, never inside the
// library itself), then instantiates and configures
// @naskot/custom-permission-guard exactly as shown in
// __PLAN/expected-custom-permission-guard/service.md's own "### Service"
// example. Nothing else lives in this file.
import { createPool } from "mysql2/promise";
import { createCustomPermissionGuard } from "@naskot/custom-permission-guard";
import { createSqlData } from "../../shared/sql-data.js";
import { PermissionDeniedError } from "../../shared/proof.js";

export const pool = createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

export const customPermissionGuard = createCustomPermissionGuard({
  onForbidden: (reason) => {
    throw new PermissionDeniedError(reason);
  },
  groupMode: "single",
  authorizedPermissions: {
    global: { acrud: true, custom: true },
    // domain.custom is deliberately disabled here — see scenario S11 in
    // ../../shared/scenarios.ts.
    domain: { acrud: true, custom: false },
  },
  lockoutProtected: [{ resource: "groups", actions: ["access", "modify"] }],
  schemas: {
    global: {
      projects: {
        rules: ["access", "read", "create", "modify", "delete"],
        custom: { "2fa": (accountId) => typeof accountId === "string" && accountId.startsWith("has2fa-") },
      },
      groups: { rules: ["access", "modify"] },
    },
    domain: {
      workspace: { rules: ["access", "read", "modify"], bridgeFromGlobal: "projects" },
      tasks: { rules: ["access", "read"], dependsOn: [{ resource: "workspace", action: "access" }] },
    },
  },
  data: createSqlData(pool),
});
