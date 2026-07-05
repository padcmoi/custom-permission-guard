import { beforeEach, describe, expect, it } from "vitest";
import { createCustomPermissionGuard } from "../../src/index.js";
import { createFakeData, createFakeStore } from "../helpers/fake-data.js";
import type { FakeStore } from "../helpers/fake-data.js";

class TestForbiddenError extends Error {}

describe("createCustomPermissionGuard", () => {
  let store: FakeStore;
  beforeEach(() => {
    store = createFakeStore();
  });

  function build() {
    return createCustomPermissionGuard({
      onForbidden: (reason) => {
        throw new TestForbiddenError(reason);
      },
      data: createFakeData(store),
      groupMode: "multiple",
      schemas: {
        global: { domains: { rules: ["access", "read", "create"] } },
        domain: {},
      },
    });
  }

  it("aggregates every method from every module onto a single object", () => {
    const guard = build();
    for (const method of [
      "assertOne",
      "assertAll",
      "getEffectivePermissions",
      "listGroups",
      "findGroup",
      "createGroup",
      "updateGroup",
      "deleteGroup",
      "setGroupOwner",
      "findGroupGlobalPermissions",
      "findGroupDomainPermissions",
      "setGroupGlobalPermissions",
      "setGroupDomainPermissions",
      "assignAccountToGroup",
      "removeAccountFromGroup",
      "findGroupMemberIds",
      "setDefaultGroup",
      "onAccountCreated",
    ]) {
      expect(guard).toHaveProperty(method);
    }
  });

  it("wires group creation, permission grants and membership through to assertOne end to end", async () => {
    const guard = build();
    const groupId = await guard.createGroup("admins");
    await guard.setGroupGlobalPermissions(groupId, [
      { resource: "domains", action: "access" },
      { resource: "domains", action: "create" },
    ]);
    await guard.assignAccountToGroup(42, groupId);

    await expect(guard.assertOne.global(42, "domains", { acrud: ["create"] })).resolves.toBeUndefined();
    await expect(guard.assertOne.global(42, "domains", { acrud: ["access"] })).resolves.toBeUndefined();
  });

  it("denies a different account not assigned to that group", async () => {
    const guard = build();
    const groupId = await guard.createGroup("admins");
    await guard.setGroupGlobalPermissions(groupId, [{ resource: "domains", action: "access" }]);
    await guard.assignAccountToGroup(42, groupId);

    await expect(guard.assertOne.global(43, "domains", { acrud: ["access"] })).rejects.toBeInstanceOf(TestForbiddenError);
  });

  it("getEffectivePermissions reflects a grant made through setGroupGlobalPermissions", async () => {
    const guard = build();
    const groupId = await guard.createGroup("admins");
    await guard.setGroupGlobalPermissions(groupId, [{ resource: "domains", action: "access" }]);
    await guard.assignAccountToGroup(42, groupId);

    const effective = await guard.getEffectivePermissions(42);
    expect(effective.global).toEqual([{ resource: "domains", action: "access" }]);
  });
});
