import { beforeEach, describe, expect, it } from "vitest";
import { createGetEffectivePermissions } from "../../src/effective-permissions.js";
import { mergeWithDefaults } from "../../src/defaults.js";
import {
  createFakeData,
  createFakeStore,
  seedDomainPermission,
  seedGlobalPermission,
  seedGroupMembership,
  seedOwnedDomain,
} from "../helpers/fake-data.js";
import type { FakeStore } from "../helpers/fake-data.js";

function testConfig(store: FakeStore) {
  return mergeWithDefaults({
    onForbidden: (reason) => {
      throw new Error(reason);
    },
    data: createFakeData(store),
    groupMode: "multiple",
    schemas: {
      global: { domains: { rules: ["access", "read", "modify"] } },
      domain: {
        domain: { rules: ["access", "read", "modify"], bridgeFromGlobal: "domains" },
        recipients: { rules: ["access", "read"] },
      },
    },
  });
}

describe("getEffectivePermissions", () => {
  let store: FakeStore;
  beforeEach(() => {
    store = createFakeStore();
  });

  it("never throws and returns empty arrays for an account with zero groups and no ownership", async () => {
    const getEffectivePermissions = createGetEffectivePermissions(testConfig(store));
    await expect(getEffectivePermissions(1)).resolves.toEqual({ global: [], domain: [] });
  });

  it("unions global grants across groups without duplicates", async () => {
    seedGroupMembership(store, 1, 10);
    seedGroupMembership(store, 1, 20);
    seedGlobalPermission(store, 10, "domains", "access");
    seedGlobalPermission(store, 20, "domains", "access"); // duplicate across groups
    seedGlobalPermission(store, 20, "domains", "read");
    const getEffectivePermissions = createGetEffectivePermissions(testConfig(store));
    const result = await getEffectivePermissions(1);
    expect(result.global).toEqual(
      expect.arrayContaining([
        { resource: "domains", action: "access" },
        { resource: "domains", action: "read" },
      ])
    );
    expect(result.global).toHaveLength(2);
  });

  it("reflects group-granted domain rows", async () => {
    seedGroupMembership(store, 1, 10);
    seedDomainPermission(store, 10, 7, "recipients", "access");
    const getEffectivePermissions = createGetEffectivePermissions(testConfig(store));
    const result = await getEffectivePermissions(1);
    expect(result.domain).toEqual([{ domainId: 7, resource: "recipients", action: "access" }]);
  });

  it("synthesizes ownership as full domain rows across every schemas.domain resource", async () => {
    seedOwnedDomain(store, 1, 7);
    const getEffectivePermissions = createGetEffectivePermissions(testConfig(store));
    const result = await getEffectivePermissions(1);
    expect(result.domain).toEqual(
      expect.arrayContaining([
        { domainId: 7, resource: "domain", action: "access" },
        { domainId: 7, resource: "domain", action: "read" },
        { domainId: 7, resource: "domain", action: "modify" },
        { domainId: 7, resource: "recipients", action: "access" },
        { domainId: 7, resource: "recipients", action: "read" },
      ])
    );
  });

  it("never synthesizes bridgeFromGlobal grants (asymmetric with ownership by design)", async () => {
    seedGroupMembership(store, 1, 10);
    seedGlobalPermission(store, 10, "domains", "access");
    seedGlobalPermission(store, 10, "domains", "modify");
    const getEffectivePermissions = createGetEffectivePermissions(testConfig(store));
    const result = await getEffectivePermissions(1);
    expect(result.domain).toEqual([]);
  });
});
