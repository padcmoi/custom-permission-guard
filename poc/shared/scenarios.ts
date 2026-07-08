import type { Pool } from "mysql2/promise";
import type { CustomPermissionGuard } from "@naskot/custom-permission-guard";
import { CustomPermissionGuardConfigError } from "@naskot/custom-permission-guard";
import { seedAccount, seedDomain } from "./sql-data.js";
import { assertEq, assertRejects, assertTrue, PermissionDeniedError, step } from "./proof.js";

function uniqueId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

// The full proof battery, shared by all 4 apps — traces directly to
// __PLAN/expected-custom-permission-guard/examples.md plus the two
// resolved-in-session behaviors (unknown resource -> config error,
// authorizedPermissions kill-switch). The example domain is invented and
// generic (a "projects" app) — this lib and its POC never reference the
// mail-server project's own resources; that mapping lives only in __PLAN.
// Every app configures its guard with the SAME schemas (see each app's
// custom-permission-guard service/module) so this file never has to branch
// on framework, only on groupMode for the one scenario where cardinality
// itself is what's being proven.
export async function runScenarios(guard: CustomPermissionGuard, pool: Pool, groupMode: "single" | "multiple") {
  await step("S01 baseline: zero groups + no ownership denies everything", async () => {
    const acc = uniqueId("acc");
    await seedAccount(pool, acc);
    await assertRejects(() => guard.assertOne.global(acc, "projects", { acrud: ["access"] }), PermissionDeniedError, "S01");
  });

  await step("S02 access missing denies read even though a raw read row exists (check-time prerequisite)", async () => {
    const acc = uniqueId("acc");
    await seedAccount(pool, acc);
    const groupId = await guard.createGroup(uniqueId("group"));
    // Raw insert bypassing setGroupGlobalPermissions' own write-time cleanup,
    // to prove the prerequisite is ALSO enforced independently at check-time.
    await pool.query("INSERT INTO group_global_permissions (group_id, resource, action) VALUES (?, 'projects', 'read')", [
      groupId,
    ]);
    await guard.assignAccountToGroup(acc, groupId);
    await assertRejects(() => guard.assertOne.global(acc, "projects", { acrud: ["read"] }), PermissionDeniedError, "S02");
  });

  await step("S03 access + read both present grants read", async () => {
    const acc = uniqueId("acc");
    await seedAccount(pool, acc);
    const groupId = await guard.createGroup(uniqueId("group"));
    await guard.setGroupGlobalPermissions(groupId, [
      { resource: "projects", action: "access" },
      { resource: "projects", action: "read" },
    ]);
    await guard.assignAccountToGroup(acc, groupId);
    await guard.assertOne.global(acc, "projects", { acrud: ["read"] });
  });

  if (groupMode === "multiple") {
    await step("S04 multiple-mode: OR across groups (2 deny create, 1 grants)", async () => {
      const acc = uniqueId("acc");
      await seedAccount(pool, acc);
      const [g1, g2, g3] = await Promise.all([
        guard.createGroup(uniqueId("g")),
        guard.createGroup(uniqueId("g")),
        guard.createGroup(uniqueId("g")),
      ]);
      await guard.setGroupGlobalPermissions(g1, [
        { resource: "projects", action: "access" },
        { resource: "projects", action: "read" },
      ]);
      await guard.setGroupGlobalPermissions(g2, [
        { resource: "projects", action: "access" },
        { resource: "projects", action: "read" },
      ]);
      await guard.setGroupGlobalPermissions(g3, [
        { resource: "projects", action: "access" },
        { resource: "projects", action: "read" },
        { resource: "projects", action: "create" },
      ]);
      await guard.assignAccountToGroup(acc, g1);
      await guard.assignAccountToGroup(acc, g2);
      await guard.assignAccountToGroup(acc, g3);
      await guard.assertOne.global(acc, "projects", { acrud: ["create"] });
    });
  } else {
    await step("S04 single-mode: a second group assignment violates the schema's UNIQUE(account_id)", async () => {
      const acc = uniqueId("acc");
      await seedAccount(pool, acc);
      const g1 = await guard.createGroup(uniqueId("g"));
      const g2 = await guard.createGroup(uniqueId("g"));
      await guard.assignAccountToGroup(acc, g1);
      await assertRejects(() => guard.assignAccountToGroup(acc, g2), Error, "S04");
    });
  }

  await step("S05 domain ownership bypasses everything with zero groups", async () => {
    const acc = uniqueId("acc");
    await seedAccount(pool, acc);
    const domainId = await seedDomain(pool, `${uniqueId("owned")}.test`, acc);
    await guard.assertOne.domain(acc, domainId, "tasks", { acrud: ["access", "read"] });
  });

  await step("S06 bridge grants the declared resource on any domainId, without a dedicated row", async () => {
    const acc = uniqueId("acc");
    await seedAccount(pool, acc);
    const domainId = await seedDomain(pool, `${uniqueId("bridge")}.test`);
    const groupId = await guard.createGroup(uniqueId("group"));
    await guard.setGroupGlobalPermissions(groupId, [
      { resource: "projects", action: "access" },
      { resource: "projects", action: "modify" },
    ]);
    await guard.assignAccountToGroup(acc, groupId);
    await guard.assertOne.domain(acc, domainId, "workspace", { acrud: ["modify"] });
  });

  await step("S06b bridge does not leak into a sibling resource's own acrud", async () => {
    const acc = uniqueId("acc");
    await seedAccount(pool, acc);
    const domainId = await seedDomain(pool, `${uniqueId("bridge")}.test`);
    const groupId = await guard.createGroup(uniqueId("group"));
    await guard.setGroupGlobalPermissions(groupId, [
      { resource: "projects", action: "access" },
      { resource: "projects", action: "modify" },
    ]);
    await guard.assignAccountToGroup(acc, groupId);
    await assertRejects(
      () => guard.assertOne.domain(acc, domainId, "tasks", { acrud: ["access"] }),
      PermissionDeniedError,
      "S06b"
    );
  });

  await step(
    "S07 dependsOn denies the dependent resource when workspace:access is missing, even with its own rows present",
    async () => {
      const acc = uniqueId("acc");
      await seedAccount(pool, acc);
      const domainId = await seedDomain(pool, `${uniqueId("dep")}.test`);
      const groupId = await guard.createGroup(uniqueId("group"));
      await guard.setGroupDomainPermissions(groupId, [
        { domainId, resource: "tasks", action: "access" },
        { domainId, resource: "tasks", action: "read" },
      ]);
      await guard.assignAccountToGroup(acc, groupId);
      await assertRejects(
        () => guard.assertOne.domain(acc, domainId, "tasks", { acrud: ["read"] }),
        PermissionDeniedError,
        "S07"
      );
    }
  );

  await step("S08 dependsOn is satisfied recursively via the dependency's own bridge", async () => {
    const acc = uniqueId("acc");
    await seedAccount(pool, acc);
    const domainId = await seedDomain(pool, `${uniqueId("dep")}.test`);
    const groupId = await guard.createGroup(uniqueId("group"));
    await guard.setGroupGlobalPermissions(groupId, [
      { resource: "projects", action: "access" },
      { resource: "projects", action: "modify" },
    ]);
    await guard.setGroupDomainPermissions(groupId, [{ domainId, resource: "tasks", action: "access" }]);
    await guard.assignAccountToGroup(acc, groupId);
    await guard.assertOne.domain(acc, domainId, "tasks", { acrud: ["access"] });
  });

  await step("S09 custom check granted", async () => {
    const acc = uniqueId("has2fa");
    await guard.assertOne.global(acc, "projects", { custom: ["2fa"] });
  });

  await step("S10 custom check denied", async () => {
    const acc = uniqueId("no2fa");
    await assertRejects(() => guard.assertOne.global(acc, "projects", { custom: ["2fa"] }), PermissionDeniedError, "S10");
  });

  await step("S11 authorizedPermissions kill-switch throws a config error regardless of schemas", async () => {
    const acc = uniqueId("acc");
    const domainId = await seedDomain(pool, `${uniqueId("killswitch")}.test`);
    await assertRejects(
      () => guard.assertOne.domain(acc, domainId, "tasks", { custom: ["whatever"] }),
      CustomPermissionGuardConfigError,
      "S11"
    );
  });

  await step("S12 unknown resource/action throws a distinct config error, never onForbidden", async () => {
    const acc = uniqueId("acc");
    await assertRejects(
      () => guard.assertOne.global(acc, "typo-resource", { acrud: ["access"] }),
      CustomPermissionGuardConfigError,
      "S12"
    );
  });

  await step("S13 write-time cleanup strips orphaned entries; readback proves zero rows stored", async () => {
    const groupId = await guard.createGroup(uniqueId("group"));
    await guard.setGroupGlobalPermissions(groupId, [{ resource: "projects", action: "read" }]); // no access
    const perms = await guard.findGroupGlobalPermissions(groupId);
    assertEq(perms.length, 0, "S13");
  });

  await step("S14 anti-lockout refuses the last protected group, accepts once a second holds it", async () => {
    const groupId = await guard.createGroup(uniqueId("group"));
    await guard.setGroupGlobalPermissions(groupId, [
      { resource: "groups", action: "access" },
      { resource: "groups", action: "modify" },
    ]);
    await assertRejects(
      () => guard.setGroupGlobalPermissions(groupId, [{ resource: "groups", action: "access" }]),
      PermissionDeniedError,
      "S14a"
    );

    const secondGroupId = await guard.createGroup(uniqueId("group"));
    await guard.setGroupGlobalPermissions(secondGroupId, [
      { resource: "groups", action: "access" },
      { resource: "groups", action: "modify" },
    ]);
    await guard.setGroupGlobalPermissions(groupId, [{ resource: "groups", action: "access" }]); // now OK
  });

  await step("S15 getEffectivePermissions never throws and is empty at zero state", async () => {
    const acc = uniqueId("acc");
    await seedAccount(pool, acc);
    const empty = await guard.getEffectivePermissions(acc);
    assertEq(empty.global.length, 0, "S15 global");
    assertEq(empty.domain.length, 0, "S15 domain");
  });

  await step("S16 group CRUD + membership + default group + onAccountCreated", async () => {
    const groupId = await guard.createGroup(uniqueId("everyone"));
    await guard.setDefaultGroup(groupId);
    const acc = uniqueId("newacc");
    await seedAccount(pool, acc);
    const assigned = await guard.onAccountCreated(acc);
    assertEq(assigned, groupId, "S16 auto-assigned group id");
    const members = await guard.findGroupMemberIds(groupId);
    assertTrue(members.includes(acc), "S16 account is a member");
  });

  await step(
    "S17 global dependsOn denies the dependent resource when projects:access is missing, even with its own rows present",
    async () => {
      const acc = uniqueId("acc");
      await seedAccount(pool, acc);
      const groupId = await guard.createGroup(uniqueId("group"));
      await guard.setGroupGlobalPermissions(groupId, [
        { resource: "billing", action: "access" },
        { resource: "billing", action: "read" },
      ]);
      await guard.assignAccountToGroup(acc, groupId);
      await assertRejects(() => guard.assertOne.global(acc, "billing", { acrud: ["read"] }), PermissionDeniedError, "S17");
    }
  );

  await step("S18 global dependsOn is satisfied once projects:access is itself granted via a group row", async () => {
    const acc = uniqueId("acc");
    await seedAccount(pool, acc);
    const groupId = await guard.createGroup(uniqueId("group"));
    await guard.setGroupGlobalPermissions(groupId, [
      { resource: "projects", action: "access" },
      { resource: "billing", action: "access" },
      { resource: "billing", action: "read" },
    ]);
    await guard.assignAccountToGroup(acc, groupId);
    await guard.assertOne.global(acc, "billing", { acrud: ["read"] });
  });
}
