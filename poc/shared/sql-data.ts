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

// accounts/domains are the consumer's own tables (tables.sql ships them only
// as FK targets) — not part of CustomPermissionGuardConfig["data"].
export async function seedAccount(pool: Pool, id: string, name = id) {
  await pool.query("INSERT INTO accounts (id, name) VALUES (?, ?)", [id, name]);
}

export async function seedDomain(pool: Pool, name: string, ownerId: string | null = null) {
  const [result] = await pool.query<ResultSetHeader>("INSERT INTO domains (name, owner_id) VALUES (?, ?)", [name, ownerId]);
  return result.insertId;
}

// docker-compose's `service_healthy` only confirms mariadbd itself is up —
// the client socket can still race the server by a few hundred ms, so retry
// briefly before handing off to the scenario battery.
export async function waitForDatabase(pool: Pool, attempts = 30, delayMs = 1000) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error("database did not become ready in time");
}

// Raw-SQL (mysql2, no ORM) implementation of the lib's data.* callbacks,
// against the tables.sql schema. Shared by all 4 POC apps — each points it
// at its own schema/pool, only the framework wiring around it differs.
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
      return rows.map((r) => ({ domainId: r.domainId as number, resource: r.resource as string, action: r.action as string }));
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
      if (changes.name !== undefined) await pool.query("UPDATE `groups` SET name = ? WHERE id = ?", [changes.name, groupId]);
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
        `SELECT group_id FROM group_global_permissions WHERE resource = ? AND action IN (?) GROUP BY group_id HAVING COUNT(DISTINCT action) = ?`,
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
        if (groupId !== null) await connection.query("UPDATE `groups` SET is_default = TRUE WHERE id = ?", [groupId]);
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
