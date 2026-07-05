import { beforeEach, describe, expect, it } from "vitest";
import { createGroupPermissions } from "../../src/group-permissions.js";
import { mergeWithDefaults } from "../../src/defaults.js";
import { createFakeData, createFakeStore } from "../helpers/fake-data.js";
import type { FakeStore } from "../helpers/fake-data.js";

class TestForbiddenError extends Error {}

function testConfig(store: FakeStore, lockoutProtected: { resource: string; actions: string[] }[] = []) {
  return mergeWithDefaults({
    onForbidden: (reason) => {
      throw new TestForbiddenError(reason);
    },
    data: createFakeData(store),
    groupMode: "multiple",
    schemas: {
      global: { groups: { rules: ["access", "read", "modify"] }, recipients: { rules: ["access", "read", "create"] } },
      domain: { recipients: { rules: ["access", "read", "create"] } },
    },
    lockoutProtected,
  });
}

describe("group-permissions — find/set global", () => {
  let store: FakeStore;
  beforeEach(() => {
    store = createFakeStore();
  });

  it("readback after a full replace reflects exactly what was written", async () => {
    const gp = createGroupPermissions(testConfig(store));
    await gp.setGroupGlobalPermissions(1, [
      { resource: "recipients", action: "access" },
      { resource: "recipients", action: "read" },
    ]);
    expect(await gp.findGroupGlobalPermissions(1)).toEqual([
      { resource: "recipients", action: "access" },
      { resource: "recipients", action: "read" },
    ]);

    await gp.setGroupGlobalPermissions(1, [{ resource: "recipients", action: "access" }]);
    expect(await gp.findGroupGlobalPermissions(1)).toEqual([{ resource: "recipients", action: "access" }]);
  });

  it("strips orphaned read/create/modify/delete entries missing their resource's access, at write time", async () => {
    const gp = createGroupPermissions(testConfig(store));
    await gp.setGroupGlobalPermissions(1, [
      { resource: "recipients", action: "read" },
      { resource: "recipients", action: "create" },
    ]);
    expect(await gp.findGroupGlobalPermissions(1)).toEqual([]);
  });

  it("keeps entries for a resource that does have its access in the same write", async () => {
    const gp = createGroupPermissions(testConfig(store));
    await gp.setGroupGlobalPermissions(1, [
      { resource: "recipients", action: "access" },
      { resource: "recipients", action: "read" },
      { resource: "groups", action: "read" }, // orphaned — no groups.access in this write
    ]);
    expect(await gp.findGroupGlobalPermissions(1)).toEqual([
      { resource: "recipients", action: "access" },
      { resource: "recipients", action: "read" },
    ]);
  });
});

describe("group-permissions — find/set domain", () => {
  let store: FakeStore;
  beforeEach(() => {
    store = createFakeStore();
  });

  it("strips orphaned entries per (domainId, resource) independently", async () => {
    const gp = createGroupPermissions(testConfig(store));
    await gp.setGroupDomainPermissions(1, [
      { domainId: 7, resource: "recipients", action: "access" },
      { domainId: 7, resource: "recipients", action: "read" },
      { domainId: 9, resource: "recipients", action: "read" }, // orphaned on domain 9
    ]);
    expect(await gp.findGroupDomainPermissions(1)).toEqual([
      { domainId: 7, resource: "recipients", action: "access" },
      { domainId: 7, resource: "recipients", action: "read" },
    ]);
  });
});

describe("group-permissions — anti-lockout", () => {
  let store: FakeStore;
  beforeEach(() => {
    store = createFakeStore();
  });

  it("refuses a write that would leave zero groups holding a protected combo", async () => {
    const gp = createGroupPermissions(testConfig(store, [{ resource: "groups", actions: ["access", "modify"] }]));
    await gp.setGroupGlobalPermissions(1, [
      { resource: "groups", action: "access" },
      { resource: "groups", action: "modify" },
    ]);

    await expect(
      gp.setGroupGlobalPermissions(1, [{ resource: "groups", action: "access" }]) // drops modify
    ).rejects.toBeInstanceOf(TestForbiddenError);
  });

  it("accepts the same write once a second group already holds the protected combo", async () => {
    const gp = createGroupPermissions(testConfig(store, [{ resource: "groups", actions: ["access", "modify"] }]));
    await gp.setGroupGlobalPermissions(1, [
      { resource: "groups", action: "access" },
      { resource: "groups", action: "modify" },
    ]);
    await gp.setGroupGlobalPermissions(2, [
      { resource: "groups", action: "access" },
      { resource: "groups", action: "modify" },
    ]);

    await expect(gp.setGroupGlobalPermissions(1, [{ resource: "groups", action: "access" }])).resolves.toBeUndefined();
  });

  it("does not protect a resource+actions combo the group never held in the first place", async () => {
    const gp = createGroupPermissions(testConfig(store, [{ resource: "groups", actions: ["access", "modify"] }]));
    await gp.setGroupGlobalPermissions(1, [{ resource: "recipients", action: "access" }]);
    await expect(gp.setGroupGlobalPermissions(1, [])).resolves.toBeUndefined();
  });
});
