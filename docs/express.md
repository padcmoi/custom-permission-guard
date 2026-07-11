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
  // Optional helpers, namespaced apart from the core surface.
  utils: {
    check: {
      global(accountId: number | string, resource: string, action: string): Promise<boolean>;
      domain(accountId: number | string, domainId: number, resource: string, action: string): Promise<boolean>;
    };
    findUnheldPermissions(
      accountId: number | string,
      required: {
        global?: { resource: string; action: string }[];
        domain?: { domainId: number; resource: string; action: string }[];
      }
    ): Promise<{
      global: { resource: string; action: string }[];
      domain: { domainId: number; resource: string; action: string }[];
    }>;
    // { added, removed } per tier; pair with findUnheldPermissions to gate an
    // edit on its delta only. See service.md for the full PermissionSet shape.
    diffPermissions(before: PermissionSet, after: PermissionSet): PermissionSetDiff;
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
import { createSqlData } from "./sql-data.js"; // shown in full further down

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
      // dependsOn works at the global tier too: "billing" is never granted
      // without projects:access first.
      billing: {
        rules: ["access", "read"],
        dependsOn: [{ resource: "projects", action: "access" }],
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
  // Raw SQL, no ORM — full source below.
  data: createSqlData(pool),
});
```

`createSqlData` is the library's entire `data` contract implemented as plain
[`mysql2`](https://github.com/sidorares/node-mysql2) queries — no ORM, no query builder — against the
reference schema in
[`__PLAN/expected-custom-permission-guard/tables.sql`](../../__PLAN/expected-custom-permission-guard/tables.sql).
Save it next to the service, e.g. `src/services/sql-data.ts`:

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
