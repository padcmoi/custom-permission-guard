// Reserved for this lib: an injectable Nest service whose only job is
// constructing and holding @naskot/custom-permission-guard, configured
// exactly as shown in __PLAN/expected-custom-permission-guard/service.md's
// own "### Service" example — env is read here, never inside the library
// itself.
import { Injectable } from "@nestjs/common";
import { createPool } from "mysql2/promise";
import type { Pool } from "mysql2/promise";
import { createCustomPermissionGuard } from "@naskot/custom-permission-guard";
import type { CustomPermissionGuard } from "@naskot/custom-permission-guard";
import { createSqlData } from "../../../shared/sql-data.js";
import { PermissionDeniedError } from "../../../shared/proof.js";

@Injectable()
export class CustomPermissionGuardService {
  readonly pool: Pool;
  readonly guard: CustomPermissionGuard;

  constructor() {
    this.pool = createPool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT ?? 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    });

    this.guard = createCustomPermissionGuard({
      onForbidden: (reason) => {
        throw new PermissionDeniedError(reason);
      },
      groupMode: "multiple",
      authorizedPermissions: {
        global: { acrud: true, custom: true },
        // domain.custom is deliberately disabled here — see scenario S11
        // in ../../../shared/scenarios.ts.
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
          // dependsOn: "billing" is never granted without projects:access
          // first — same gate contract as the domain tier's tasks/workspace
          // pair, now also available at the global tier.
          billing: { rules: ["access", "read"], dependsOn: [{ resource: "projects", action: "access" }] },
        },
        domain: {
          workspace: { rules: ["access", "read", "modify"], bridgeFromGlobal: "projects" },
          tasks: { rules: ["access", "read"], dependsOn: [{ resource: "workspace", action: "access" }] },
        },
      },
      data: createSqlData(this.pool),
    });
  }
}
