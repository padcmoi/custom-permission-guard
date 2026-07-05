# Express Integration

> Rule: do not read `process.env` inside the library code.
> Read env values only in the Express service layer, then pass plain config to the library.

## 1) Service file

Path suggestion: `src/services/custom-permission-guard.service.ts`

The library's whole public contract is the `CustomPermissionGuard` interface, built via
`createCustomPermissionGuard(config)`. This is the authoritative shape — see
[`__PLAN/expected-custom-permission-guard/service.md`](../../__PLAN/expected-custom-permission-guard/service.md)
for the full design rationale:

```ts
interface CustomPermissionGuard {
  assertOne: {
    global(accountId: number | string, resource: string, requirements: { acrud?: string[]; custom?: string[] }): Promise<void>;
    domain(
      accountId: number | string,
      domainId: number,
      resource: string,
      requirements: { acrud?: string[]; custom?: string[] }
    ): Promise<void>;
  };
  assertAll: {
    global: {
      acrud(accountId: number | string, requirements: { resource: string; acrud?: string[] }[]): Promise<void>;
      custom(accountId: number | string, requirements: { resource: string; custom?: string[] }[]): Promise<void>;
    };
    domain: {
      acrud(accountId: number | string, domainId: number, requirements: { resource: string; acrud?: string[] }[]): Promise<void>;
      custom(
        accountId: number | string,
        domainId: number,
        requirements: { resource: string; custom?: string[] }[]
      ): Promise<void>;
    };
  };
  getEffectivePermissions(accountId: number | string): Promise<{
    global: { resource: string; action: string }[];
    domain: { domainId: number; resource: string; action: string }[];
  }>;
  // Group entity CRUD, group permission grants, membership, default group —
  // see service.md for the full method list (listGroups, createGroup,
  // setGroupGlobalPermissions, assignAccountToGroup, onAccountCreated, ...).
}
```

Instantiation — the same config shape service.md ships, read from `process.env` here in the
service layer (never inside the library):

```ts
import mysql from "mysql2/promise";
import { createCustomPermissionGuard } from "@naskot/custom-permission-guard";

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

export const customPermissionGuard = createCustomPermissionGuard({
  onForbidden: (reason) => {
    throw new Error(reason); // mapped to an HTTP 403 below, see (3)
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
        custom: {
          "2fa": (accountId) => hasTwoFactorEnabled(accountId), // your own lookup
        },
      },
    },
    domain: {
      // bridgeFromGlobal: holding projects.<action> globally also grants
      // "workspace" on ANY domainId (here, a specific project's own
      // settings), without a dedicated per-domain row.
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
    // Every callback is raw SQL/ORM code you own — the library never
    // touches a database itself. See tables.sql for a reference schema.
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
```

## 2) Route/controller usage

The library never opens routes or ships Express middleware — that glue is a few lines the
consumer writes once, on top of the agnostic `assertAll.*` primitives:

```ts
// Built on assertAll.global.* — not shipped by the lib, written once per project.
function requireGlobalPermissions(requirements) {
  return async (req, res, next) => {
    try {
      await customPermissionGuard.assertAll.global.acrud(req.user.id, requirements);
      await customPermissionGuard.assertAll.global.custom(req.user.id, requirements);
      next();
    } catch (err) {
      next(err);
    }
  };
}

function requireDomainPermissions(requirements) {
  return async (req, res, next) => {
    try {
      const domainId = Number(req.params.domainId);
      await customPermissionGuard.assertAll.domain.acrud(req.user.id, domainId, requirements);
      await customPermissionGuard.assertAll.domain.custom(req.user.id, domainId, requirements);
      next();
    } catch (err) {
      next(err);
    }
  };
}

app.get("/projects", requireGlobalPermissions([{ resource: "projects", acrud: ["access", "read"] }]), async (req, res) =>
  res.json({ status: "ok", projects: await listProjects() })
);

app.get(
  "/projects/:domainId/tasks",
  requireDomainPermissions([{ resource: "tasks", acrud: ["access", "read"] }]),
  async (req, res) => res.json({ status: "ok", tasks: await listTasks(req.params.domainId) })
);

// No permission gate: an account can always read its own effective
// permissions (nav gating, etc).
app.get("/me/permissions", async (req, res) => {
  res.json(await customPermissionGuard.getEffectivePermissions(req.user.id));
});
```

Anti-escalation (a caller can only grant permissions it already holds) and any notion of a
root/superuser bypass are both explicitly **out of the library's scope** — compose them from
`assertOne`/`assertAll` in your own route handlers, exactly like the gates above.

## 3) Error handling

`onForbidden` throws a plain `Error` for every denial (both real refusals and the library's
own config errors — see below). Map it to an HTTP 403 with a single Express error middleware,
mounted after every route:

```ts
app.use((err, req, res, next) => {
  res.status(403).json({ status: "forbidden", reason: err.message });
});
```

`CustomPermissionGuardConfigError` (also exported by the package) is thrown instead of
`onForbidden` for a misconfigured `resource`/`action`/`customName` (a typo in `schemas`, or a
tier+dimension disabled via `authorizedPermissions`) — treat it as a 500/config-time bug, not
a 403, so a typo never quietly looks like a legitimate denial:

```ts
import { CustomPermissionGuardConfigError } from "@naskot/custom-permission-guard";

app.use((err, req, res, next) => {
  if (err instanceof CustomPermissionGuardConfigError) {
    return res.status(500).json({ status: "error", reason: err.message });
  }
  res.status(403).json({ status: "forbidden", reason: err.message });
});
```

## 4) Production notes

- Required config: `onForbidden` and `data` have no default — everything else
  (`groupMode`, `authorizedPermissions`, `schemas`, `lockoutProtected`) falls back to
  `defaultValueCustomPermissionGuard` when omitted.
- The library never reads `process.env`, never opens a DB connection, and never opens an
  HTTP route — all three stay entirely the consumer's responsibility.
- `groupMode: "single"` is a contract you enforce in your own schema (e.g. `UNIQUE(account_id)`
  on your membership table) — the library doesn't add extra logic for it, it just documents
  the invariant your data is expected to uphold.
- Root/superuser bypass is not a library concept at all — if your app has one, wrap the calls
  above in your own tiny helper (`if (user.isRoot) return; return customPermissionGuard.assertOne...`)
  rather than looking for a flag on the library's config.
