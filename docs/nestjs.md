# NestJS Integration

> Rule: do not read `process.env` inside the library code.
> Read env values only in the Nest provider/service layer, then pass plain config to the library.

## 1) Provider/service

A **dedicated module reserved for this lib** — nothing else lives here — following Nest's own
module/service convention, in its own subfolder:

```
src/custom-permission-guard/
  custom-permission-guard.service.ts   -- constructs and holds the guard
  custom-permission-guard.module.ts    -- wires the service into Nest's DI
```

`custom-permission-guard.service.ts` — the only place that calls
`createCustomPermissionGuard`, configured exactly as shown in
[`__PLAN/expected-custom-permission-guard/service.md`](../../__PLAN/expected-custom-permission-guard/service.md)'s
own "### Service" example:

```ts
import { Injectable } from "@nestjs/common";
import { createPool } from "mysql2/promise";
import type { Pool } from "mysql2/promise";
import { createCustomPermissionGuard } from "@naskot/custom-permission-guard";
import type { CustomPermissionGuard } from "@naskot/custom-permission-guard";
import { createSqlData } from "./sql-data.js"; // shown in full further down

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
        throw new Error(reason); // mapped to a NestJS exception below, see (4)
      },
      groupMode: "multiple",
      authorizedPermissions: {
        global: { acrud: true, custom: true },
        domain: { acrud: true, custom: true },
      },
      // Never lose the last group able to manage groups themselves.
      lockoutProtected: [{ resource: "groups", actions: ["access", "modify"] }],
      schemas: {
        global: {
          groups: { rules: ["access", "read", "create", "modify", "delete"] },
          // "projects" is an invented, generic example resource — swap in
          // whatever your own app actually manages.
          projects: {
            rules: ["access", "read", "create", "modify", "delete"],
            custom: { "2fa": (accountId) => hasTwoFactorEnabled(accountId) },
          },
          // dependsOn works at the global tier too: "billing" is never
          // granted without projects:access first.
          billing: {
            rules: ["access", "read"],
            dependsOn: [{ resource: "projects", action: "access" }],
          },
        },
        domain: {
          // bridgeFromGlobal: holding projects.<action> globally also
          // grants "workspace" on ANY domainId, without a dedicated row.
          workspace: { rules: ["access", "read", "create", "modify", "delete"], bridgeFromGlobal: "projects" },
          // dependsOn: "tasks" is never granted on a project without
          // workspace:access on that SAME project first.
          tasks: {
            rules: ["access", "read", "create", "modify", "delete"],
            dependsOn: [{ resource: "workspace", action: "access" }],
          },
        },
      },
      // Raw SQL, no ORM — full source below.
      data: createSqlData(this.pool),
    });
  }
}
```

`custom-permission-guard/sql-data.ts` — the library's entire `data` contract implemented as plain
[`mysql2`](https://github.com/sidorares/node-mysql2) queries, no ORM, against the reference schema in
[`__PLAN/expected-custom-permission-guard/tables.sql`](../../__PLAN/expected-custom-permission-guard/tables.sql).
Lives in the same dedicated subfolder as the service/module:

```ts
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

interface GroupRow extends RowDataPacket {
  id: number;
  name: string;
  description: string | null;
  owner_id: string | null;
  is_default: number;
  created_at: Date;
}

interface CountRow extends RowDataPacket {
  memberCount: number;
}

export function createSqlData(pool: Pool) {
  return {
    async findAccountGroupIds(accountId: string) {
      const [rows] = await pool.query<RowDataPacket[]>("SELECT group_id AS groupId FROM account_groups WHERE account_id = ?", [
        accountId,
      ]);
      return rows.map((r) => r.groupId as number);
    },
    async findGlobalPermissions(groupId: number) {
      const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT resource, action FROM group_global_permissions WHERE group_id = ?",
        [groupId]
      );
      return rows.map((r) => ({ resource: r.resource as string, action: r.action as string }));
    },
    async findDomainPermissions(groupId: number) {
      const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT domain_id AS domainId, resource, action FROM group_domain_permissions WHERE group_id = ?",
        [groupId]
      );
      return rows.map((r) => ({
        domainId: r.domainId as number,
        resource: r.resource as string,
        action: r.action as string,
      }));
    },
    async findOwnedDomainIds(accountId: string) {
      const [rows] = await pool.query<RowDataPacket[]>("SELECT id FROM domains WHERE owner_id = ?", [accountId]);
      return rows.map((r) => r.id as number);
    },

    async createGroup(name: string) {
      const [result] = await pool.query<ResultSetHeader>("INSERT INTO `groups` (name) VALUES (?)", [name]);
      return result.insertId;
    },
    async listGroups() {
      const [rows] = await pool.query<GroupRow[]>("SELECT id, name, description, owner_id, is_default, created_at FROM `groups`");
      const groups = [];
      for (const g of rows) {
        const [[count]] = await pool.query<CountRow[]>("SELECT COUNT(*) AS memberCount FROM account_groups WHERE group_id = ?", [
          g.id,
        ]);
        groups.push({
          id: g.id,
          name: g.name,
          description: g.description,
          ownerId: g.owner_id,
          isDefault: Boolean(g.is_default),
          memberCount: count.memberCount,
          createdAt: g.created_at,
        });
      }
      return groups;
    },
    async findGroup(groupId: number) {
      const [rows] = await pool.query<GroupRow[]>(
        "SELECT id, name, description, owner_id, is_default, created_at FROM `groups` WHERE id = ?",
        [groupId]
      );
      const g = rows[0];
      if (!g) return null;
      return {
        id: g.id,
        name: g.name,
        description: g.description,
        ownerId: g.owner_id,
        isDefault: Boolean(g.is_default),
        createdAt: g.created_at,
      };
    },
    async updateGroup(groupId: number, changes: { name?: string; description?: string }) {
      if (changes.name !== undefined) {
        await pool.query("UPDATE `groups` SET name = ? WHERE id = ?", [changes.name, groupId]);
      }
      if (changes.description !== undefined) {
        await pool.query("UPDATE `groups` SET description = ? WHERE id = ?", [changes.description, groupId]);
      }
    },
    async setGroupOwner(groupId: number, accountId: string | null) {
      await pool.query("UPDATE `groups` SET owner_id = ? WHERE id = ?", [accountId, groupId]);
    },
    async deleteGroup(groupId: number) {
      await pool.query("DELETE FROM `groups` WHERE id = ?", [groupId]);
    },

    async setGroupGlobalPermissions(groupId: number, permissions: { resource: string; action: string }[]) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.query("DELETE FROM group_global_permissions WHERE group_id = ?", [groupId]);
        for (const { resource, action } of permissions) {
          await connection.query("INSERT INTO group_global_permissions (group_id, resource, action) VALUES (?, ?, ?)", [
            groupId,
            resource,
            action,
          ]);
        }
        await connection.commit();
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }
    },
    async setGroupDomainPermissions(groupId: number, permissions: { domainId: number; resource: string; action: string }[]) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.query("DELETE FROM group_domain_permissions WHERE group_id = ?", [groupId]);
        for (const { domainId, resource, action } of permissions) {
          await connection.query(
            "INSERT INTO group_domain_permissions (group_id, domain_id, resource, action) VALUES (?, ?, ?, ?)",
            [groupId, domainId, resource, action]
          );
        }
        await connection.commit();
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }
    },
    async countGroupsWithGlobalPermission(resource: string, actions: string[]) {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT group_id FROM group_global_permissions WHERE resource = ? AND action IN (?)
         GROUP BY group_id HAVING COUNT(DISTINCT action) = ?`,
        [resource, actions, actions.length]
      );
      return rows.length;
    },

    async assignAccountToGroup(accountId: string, groupId: number) {
      await pool.query("INSERT INTO account_groups (account_id, group_id) VALUES (?, ?)", [accountId, groupId]);
    },
    async findGroupMemberIds(groupId: number) {
      const [rows] = await pool.query<RowDataPacket[]>("SELECT account_id AS accountId FROM account_groups WHERE group_id = ?", [
        groupId,
      ]);
      return rows.map((r) => r.accountId as string);
    },
    async removeAccountFromGroup(accountId: string, groupId: number) {
      await pool.query("DELETE FROM account_groups WHERE account_id = ? AND group_id = ?", [accountId, groupId]);
    },

    async setDefaultGroup(groupId: number | null) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.query("UPDATE `groups` SET is_default = FALSE WHERE is_default = TRUE");
        if (groupId !== null) {
          await connection.query("UPDATE `groups` SET is_default = TRUE WHERE id = ?", [groupId]);
        }
        await connection.commit();
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }
    },
    async findDefaultGroupId() {
      const [rows] = await pool.query<RowDataPacket[]>("SELECT id FROM `groups` WHERE is_default = TRUE LIMIT 1");
      return rows[0] ? (rows[0].id as number) : null;
    },
  };
}
```

`custom-permission-guard.module.ts` — wires the service into Nest's DI, exports it so any other
module can inject it:

```ts
import { Module } from "@nestjs/common";
import { CustomPermissionGuardService } from "./custom-permission-guard.service.js";

@Module({
  providers: [CustomPermissionGuardService],
  exports: [CustomPermissionGuardService],
})
export class CustomPermissionGuardModule {}
```

## 2) Usage in another service/controller

```ts
import { Injectable } from "@nestjs/common";
import { CustomPermissionGuardService } from "../custom-permission-guard/custom-permission-guard.service.js";

@Injectable()
export class ProjectsService {
  constructor(private readonly permissions: CustomPermissionGuardService) {}

  async listForAccount(accountId: number | string) {
    await this.permissions.guard.assertOne.global(accountId, "projects", { acrud: ["access", "read"] });
    return this.db.listProjects();
  }
}
```

A thin, reusable guard/decorator pair (built on `assertAll.*`, never shipped by the lib itself)
is the idiomatic way to gate a whole route instead of calling `assertOne` inline everywhere:

```ts
import { CanActivate, ExecutionContext, Injectable, mixin } from "@nestjs/common";
import type { Type } from "@nestjs/common";
import { CustomPermissionGuardService } from "../custom-permission-guard/custom-permission-guard.service.js";

export function RequireGlobalPermissions(
  requirements: { resource: string; acrud?: string[]; custom?: string[] }[]
): Type<CanActivate> {
  @Injectable()
  class RequireGlobalPermissionsGuard implements CanActivate {
    constructor(private readonly permissions: CustomPermissionGuardService) {}
    async canActivate(ctx: ExecutionContext) {
      const req = ctx.switchToHttp().getRequest();
      await this.permissions.guard.assertAll.global.acrud(req.user.id, requirements);
      await this.permissions.guard.assertAll.global.custom(req.user.id, requirements);
      return true;
    }
  }
  return mixin(RequireGlobalPermissionsGuard);
}

export function RequireDomainPermissions(
  requirements: { resource: string; acrud?: string[]; custom?: string[] }[]
): Type<CanActivate> {
  @Injectable()
  class RequireDomainPermissionsGuard implements CanActivate {
    constructor(private readonly permissions: CustomPermissionGuardService) {}
    async canActivate(ctx: ExecutionContext) {
      const req = ctx.switchToHttp().getRequest();
      // Illustrative accessor — adapt to wherever your own routes carry the
      // domainId (params, a resolved entity, etc).
      const domainId = Number(req.params.domainId);
      await this.permissions.guard.assertAll.domain.acrud(req.user.id, domainId, requirements);
      await this.permissions.guard.assertAll.domain.custom(req.user.id, domainId, requirements);
      return true;
    }
  }
  return mixin(RequireDomainPermissionsGuard);
}
```

```ts
@UseGuards(RequireGlobalPermissions([{ resource: "projects", acrud: ["access", "read"] }]))
@Get("projects")
listProjects() {
  return this.projectsService.listAll();
}

@UseGuards(RequireDomainPermissions([{ resource: "tasks", acrud: ["access", "read"] }]))
@Get("projects/:domainId/tasks")
listTasks(@Param("domainId") domainId: string) {
  return this.tasksService.listForProject(domainId);
}
```

Anti-escalation and any root/superuser bypass are both explicitly **out of the library's
scope** — compose them the same way, from `assertOne`/`assertAll`, never as a library config
flag.

## 3) Module wiring

```ts
@Module({
  imports: [CustomPermissionGuardModule, DomainsModule /* ... */],
})
export class AppModule {}
```

## 4) Production notes

- **Critical**: `onForbidden` must throw a NestJS `ForbiddenException` (from `@nestjs/common`),
  not a plain `Error` — inside a `CanActivate.canActivate()`, an unhandled plain `Error` becomes
  an HTTP 500, not a 403:
  ```ts
  import { ForbiddenException } from "@nestjs/common";
  onForbidden: (reason) => {
    throw new ForbiddenException(reason);
  };
  ```
- `CustomPermissionGuardConfigError` (also exported by the package) is thrown instead, for a
  misconfigured `resource`/`action`/`customName` or a tier+dimension disabled via
  `authorizedPermissions` — let it propagate as a 500/config-time bug rather than catching it
  alongside `ForbiddenException`, so a typo in `schemas` never quietly looks like a real 403.
- Required config: `onForbidden` and `data` have no default — everything else
  (`groupMode`, `authorizedPermissions`, `schemas`, `lockoutProtected`) falls back to
  `defaultValueCustomPermissionGuard` when omitted.
- The library never reads `process.env`, never opens a DB connection itself, and never
  registers a route or controller — all three stay entirely the consumer's responsibility.
- `groupMode: "single"` is a contract you enforce in your own schema (e.g. `UNIQUE(account_id)`
  on your membership table) — the library doesn't add extra logic for it.
