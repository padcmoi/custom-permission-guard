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
      data: {
        // Every callback is raw SQL/ORM/TypeORM code you own — the library
        // never touches a database itself.
        findAccountGroupIds: (accountId) => db.findAccountGroupIds(accountId),
        findGlobalPermissions: (groupId) => db.findGlobalPermissions(groupId),
        findDomainPermissions: (groupId) => db.findDomainPermissions(groupId),
        findOwnedDomainIds: (accountId) => db.findOwnedDomainIds(accountId),
        createGroup: (name) => db.createGroup(name),
        listGroups: () => db.listGroups(),
        findGroup: (groupId) => db.findGroup(groupId),
        updateGroup: (groupId, changes) => db.updateGroup(groupId, changes),
        setGroupOwner: (groupId, accountId) => db.setGroupOwner(groupId, accountId),
        deleteGroup: (groupId) => db.deleteGroup(groupId),
        setGroupGlobalPermissions: (groupId, permissions) => db.setGroupGlobalPermissions(groupId, permissions),
        setGroupDomainPermissions: (groupId, permissions) => db.setGroupDomainPermissions(groupId, permissions),
        countGroupsWithGlobalPermission: (resource, actions) => db.countGroupsWithGlobalPermission(resource, actions),
        assignAccountToGroup: (accountId, groupId) => db.assignAccountToGroup(accountId, groupId),
        findGroupMemberIds: (groupId) => db.findGroupMemberIds(groupId),
        removeAccountFromGroup: (accountId, groupId) => db.removeAccountFromGroup(accountId, groupId),
        setDefaultGroup: (groupId) => db.setDefaultGroup(groupId),
        findDefaultGroupId: () => db.findDefaultGroupId(),
      },
    });
  }
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
