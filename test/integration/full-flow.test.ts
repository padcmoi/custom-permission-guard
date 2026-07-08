import mysql from "mysql2/promise";
import { GenericContainer, Wait } from "testcontainers";
import type { StartedTestContainer } from "testcontainers";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createCustomPermissionGuard } from "../../src/index.js";
import { createSqlData, seedAccount, seedDomain } from "../helpers/sql-data.js";
import { SQL_SCHEMA } from "../helpers/sql-schema.js";

class TestForbiddenError extends Error {}

describe("integration — full flow against a real MariaDB", () => {
  let container: StartedTestContainer;
  let pool: mysql.Pool;

  beforeAll(async () => {
    container = await new GenericContainer("mariadb:11")
      .withEnvironment({ MARIADB_ROOT_PASSWORD: "root", MARIADB_DATABASE: "cpg_test", MARIADB_AUTO_UPGRADE: "1" })
      .withExposedPorts(3306)
      .withWaitStrategy(Wait.forLogMessage(/ready for connections/, 2))
      .withStartupTimeout(60_000)
      .start();

    pool = mysql.createPool({
      host: container.getHost(),
      port: container.getMappedPort(3306),
      user: "root",
      password: "root",
      database: "cpg_test",
      multipleStatements: true,
    });

    // The wait strategy above blocks on the server's own readiness log line,
    // but the client socket can still race it by a few hundred ms — retry
    // briefly rather than fail on the very first connection attempt.
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        await pool.query("SELECT 1");
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    await pool.query(SQL_SCHEMA);
  });

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  afterEach(async () => {
    // Children before parents so FK constraints don't block the wipe.
    for (const table of [
      "group_domain_permissions",
      "group_global_permissions",
      "account_groups",
      "groups",
      "domains",
      "accounts",
    ]) {
      await pool.query(`DELETE FROM \`${table}\``);
    }
  });

  function buildGuard() {
    return createCustomPermissionGuard({
      onForbidden: (reason) => {
        throw new TestForbiddenError(reason);
      },
      data: createSqlData(pool),
      groupMode: "multiple",
      lockoutProtected: [{ resource: "groups", actions: ["access", "modify"] }],
      schemas: {
        global: {
          domains: { rules: ["access", "read", "create", "modify"] },
          groups: { rules: ["access", "modify"] },
          billing: { rules: ["access", "read"], dependsOn: [{ resource: "domains", action: "access" }] },
        },
        domain: {
          domain: { rules: ["access", "modify"], bridgeFromGlobal: "domains" },
          recipients: { rules: ["access", "read"], dependsOn: [{ resource: "domain", action: "access" }] },
        },
      },
    });
  }

  it("grants and denies through a real group -> permissions -> membership chain", async () => {
    const guard = buildGuard();
    await seedAccount(pool, "acc-1");
    const groupId = await guard.createGroup("admins");
    await guard.setGroupGlobalPermissions(groupId, [
      { resource: "domains", action: "access" },
      { resource: "domains", action: "create" },
    ]);
    await guard.assignAccountToGroup("acc-1", groupId);

    await expect(guard.assertOne.global("acc-1", "domains", { acrud: ["create"] })).resolves.toBeUndefined();
    await expect(guard.assertOne.global("acc-1", "domains", { acrud: ["read"] })).rejects.toBeInstanceOf(TestForbiddenError);
  });

  it("gates the global tier on dependsOn through real rows, denying then granting once the prerequisite is met", async () => {
    const guard = buildGuard();
    await seedAccount(pool, "acc-6");
    const groupId = await guard.createGroup("billing-readers");
    await guard.setGroupGlobalPermissions(groupId, [
      { resource: "billing", action: "access" },
      { resource: "billing", action: "read" },
    ]);
    await guard.assignAccountToGroup("acc-6", groupId);

    await expect(guard.assertOne.global("acc-6", "billing", { acrud: ["read"] })).rejects.toBeInstanceOf(TestForbiddenError);

    await guard.setGroupGlobalPermissions(groupId, [
      { resource: "domains", action: "access" },
      { resource: "billing", action: "access" },
      { resource: "billing", action: "read" },
    ]);
    await expect(guard.assertOne.global("acc-6", "billing", { acrud: ["read"] })).resolves.toBeUndefined();
  });

  it("persists the write-time access-prerequisite cleanup in real rows", async () => {
    const guard = buildGuard();
    const groupId = await guard.createGroup("partial");
    await guard.setGroupGlobalPermissions(groupId, [{ resource: "domains", action: "read" }]); // no access
    expect(await guard.findGroupGlobalPermissions(groupId)).toEqual([]);
  });

  it("enforces anti-lockout via the real countGroupsWithGlobalPermission query", async () => {
    const guard = buildGuard();
    const groupId = await guard.createGroup("only-admin-group");
    await guard.setGroupGlobalPermissions(groupId, [
      { resource: "groups", action: "access" },
      { resource: "groups", action: "modify" },
    ]);

    await expect(guard.setGroupGlobalPermissions(groupId, [{ resource: "groups", action: "access" }])).rejects.toBeInstanceOf(
      TestForbiddenError
    );

    const secondGroupId = await guard.createGroup("second-admin-group");
    await guard.setGroupGlobalPermissions(secondGroupId, [
      { resource: "groups", action: "access" },
      { resource: "groups", action: "modify" },
    ]);
    await expect(guard.setGroupGlobalPermissions(groupId, [{ resource: "groups", action: "access" }])).resolves.toBeUndefined();
  });

  it("grants via real domains.owner_id ownership with zero groups", async () => {
    const guard = buildGuard();
    await seedAccount(pool, "owner-1");
    const domainId = await seedDomain(pool, "example.test", "owner-1");

    await expect(
      guard.assertOne.domain("owner-1", domainId, "recipients", { acrud: ["access", "read"] })
    ).resolves.toBeUndefined();
  });

  it("bridges a global grant onto a domain-tier resource for any real domain row", async () => {
    const guard = buildGuard();
    await seedAccount(pool, "acc-2");
    const domainId = await seedDomain(pool, "bridged.test");
    const groupId = await guard.createGroup("bridge-holders");
    await guard.setGroupGlobalPermissions(groupId, [
      { resource: "domains", action: "access" },
      { resource: "domains", action: "modify" },
    ]);
    await guard.assignAccountToGroup("acc-2", groupId);

    await expect(guard.assertOne.domain("acc-2", domainId, "domain", { acrud: ["modify"] })).resolves.toBeUndefined();
  });

  it("cascades group deletion to its memberships and permission rows", async () => {
    const guard = buildGuard();
    await seedAccount(pool, "acc-3");
    const groupId = await guard.createGroup("temporary");
    await guard.setGroupGlobalPermissions(groupId, [{ resource: "domains", action: "access" }]);
    await guard.assignAccountToGroup("acc-3", groupId);

    await guard.deleteGroup(groupId);

    expect(await guard.findGroup(groupId)).toBeNull();
    expect(await guard.findGroupMemberIds(groupId)).toEqual([]);
    expect(await guard.findGroupGlobalPermissions(groupId)).toEqual([]);
  });

  it("auto-assigns a new account to the default group end to end", async () => {
    const guard = buildGuard();
    await seedAccount(pool, "acc-4");
    const groupId = await guard.createGroup("everyone");
    await guard.setDefaultGroup(groupId);

    const assigned = await guard.onAccountCreated("acc-4");
    expect(assigned).toBe(groupId);
    expect(await guard.findGroupMemberIds(groupId)).toEqual(["acc-4"]);
  });

  it("getEffectivePermissions reflects real rows across global and domain tiers", async () => {
    const guard = buildGuard();
    await seedAccount(pool, "acc-5");
    const domainId = await seedDomain(pool, "effective.test");
    const groupId = await guard.createGroup("readers");
    await guard.setGroupGlobalPermissions(groupId, [{ resource: "domains", action: "access" }]);
    await guard.setGroupDomainPermissions(groupId, [
      { domainId, resource: "domain", action: "access" },
      { domainId, resource: "recipients", action: "access" },
    ]);
    await guard.assignAccountToGroup("acc-5", groupId);

    const effective = await guard.getEffectivePermissions("acc-5");
    expect(effective.global).toEqual([{ resource: "domains", action: "access" }]);
    expect(effective.domain).toEqual(
      expect.arrayContaining([
        { domainId, resource: "domain", action: "access" },
        { domainId, resource: "recipients", action: "access" },
      ])
    );
  });
});
