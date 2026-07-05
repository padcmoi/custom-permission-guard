import { beforeEach, describe, expect, it } from "vitest";
import { createGroups } from "../../src/groups.js";
import { mergeWithDefaults } from "../../src/defaults.js";
import { createFakeData, createFakeStore, seedGlobalPermission } from "../helpers/fake-data.js";
import type { FakeStore } from "../helpers/fake-data.js";

class TestForbiddenError extends Error {}

function testConfig(store: FakeStore, lockoutProtected: { resource: string; actions: string[] }[] = []) {
  return mergeWithDefaults({
    onForbidden: (reason) => {
      throw new TestForbiddenError(reason);
    },
    data: createFakeData(store),
    groupMode: "multiple",
    schemas: { global: { groups: { rules: ["access", "read", "modify"] } }, domain: {} },
    lockoutProtected,
  });
}

describe("groups — CRUD pass-through", () => {
  let store: FakeStore;
  beforeEach(() => {
    store = createFakeStore();
  });

  it("creates, finds, updates and deletes a group", async () => {
    const groups = createGroups(testConfig(store));
    const id = await groups.createGroup("admins");
    expect(await groups.findGroup(id)).toMatchObject({ id, name: "admins", description: null, isDefault: false });

    await groups.updateGroup(id, { description: "Administrators" });
    expect((await groups.findGroup(id))?.description).toBe("Administrators");

    await groups.deleteGroup(id);
    expect(await groups.findGroup(id)).toBeNull();
  });

  it("lists groups with an accurate member count", async () => {
    const groups = createGroups(testConfig(store));
    const id = await groups.createGroup("admins");
    await groups.assignAccountToGroup(1, id);
    await groups.assignAccountToGroup(2, id);
    const list = await groups.listGroups();
    expect(list.find((g) => g.id === id)?.memberCount).toBe(2);
  });

  it("sets and clears a group owner as pure data", async () => {
    const groups = createGroups(testConfig(store));
    const id = await groups.createGroup("admins");
    await groups.setGroupOwner(id, 9);
    expect((await groups.findGroup(id))?.ownerId).toBe(9);
    await groups.setGroupOwner(id, null);
    expect((await groups.findGroup(id))?.ownerId).toBeNull();
  });
});

describe("groups — membership", () => {
  let store: FakeStore;
  beforeEach(() => {
    store = createFakeStore();
  });

  it("assigns, lists and removes members", async () => {
    const groups = createGroups(testConfig(store));
    const id = await groups.createGroup("admins");
    await groups.assignAccountToGroup(1, id);
    await groups.assignAccountToGroup(2, id);
    expect(await groups.findGroupMemberIds(id)).toEqual(expect.arrayContaining([1, 2]));

    await groups.removeAccountFromGroup(1, id);
    expect(await groups.findGroupMemberIds(id)).toEqual([2]);
  });
});

describe("groups — default group + onAccountCreated", () => {
  let store: FakeStore;
  beforeEach(() => {
    store = createFakeStore();
  });

  it("returns null and assigns nothing when there is no default group", async () => {
    const groups = createGroups(testConfig(store));
    await expect(groups.onAccountCreated(42)).resolves.toBeNull();
    expect(await groups.findGroupMemberIds(1)).toEqual([]);
  });

  it("auto-assigns a newly created account to the default group", async () => {
    const groups = createGroups(testConfig(store));
    const id = await groups.createGroup("everyone");
    await groups.setDefaultGroup(id);

    const assignedId = await groups.onAccountCreated(42);
    expect(assignedId).toBe(id);
    expect(await groups.findGroupMemberIds(id)).toEqual([42]);
  });

  it("keeps only one group marked default at a time", async () => {
    const groups = createGroups(testConfig(store));
    const first = await groups.createGroup("first");
    const second = await groups.createGroup("second");

    await groups.setDefaultGroup(first);
    await groups.setDefaultGroup(second);

    expect((await groups.findGroup(first))?.isDefault).toBe(false);
    expect((await groups.findGroup(second))?.isDefault).toBe(true);
  });
});

describe("groups — deleteGroup respects lockoutProtected", () => {
  let store: FakeStore;
  beforeEach(() => {
    store = createFakeStore();
  });

  it("refuses to delete the last group holding a protected combo", async () => {
    const groups = createGroups(testConfig(store, [{ resource: "groups", actions: ["access", "modify"] }]));
    const id = await groups.createGroup("admins");
    seedGlobalPermission(store, id, "groups", "access");
    seedGlobalPermission(store, id, "groups", "modify");

    await expect(groups.deleteGroup(id)).rejects.toBeInstanceOf(TestForbiddenError);
    expect(await groups.findGroup(id)).not.toBeNull();
  });

  it("allows deletion once a second group already holds the protected combo", async () => {
    const groups = createGroups(testConfig(store, [{ resource: "groups", actions: ["access", "modify"] }]));
    const id = await groups.createGroup("admins");
    const other = await groups.createGroup("also-admins");
    for (const groupId of [id, other]) {
      seedGlobalPermission(store, groupId, "groups", "access");
      seedGlobalPermission(store, groupId, "groups", "modify");
    }

    await expect(groups.deleteGroup(id)).resolves.toBeUndefined();
    expect(await groups.findGroup(id)).toBeNull();
  });
});
