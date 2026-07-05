import { beforeEach, describe, expect, it } from "vitest";
import { createAssertions } from "../../src/assert.js";
import { mergeWithDefaults } from "../../src/defaults.js";
import { CustomPermissionGuardConfigError } from "../../src/errors.js";
import type { CustomPermissionGuardUserConfig } from "../../src/types.js";
import {
  createFakeData,
  createFakeStore,
  seedDomainPermission,
  seedGlobalPermission,
  seedGroupMembership,
  seedOwnedDomain,
} from "../helpers/fake-data.js";
import type { FakeStore } from "../helpers/fake-data.js";

class TestForbiddenError extends Error {}

function testConfig(store: FakeStore, overrides: Partial<CustomPermissionGuardUserConfig> = {}) {
  return mergeWithDefaults({
    onForbidden: (reason) => {
      throw new TestForbiddenError(reason);
    },
    data: createFakeData(store),
    groupMode: "multiple",
    authorizedPermissions: {
      global: { acrud: true, custom: true },
      domain: { acrud: true, custom: true },
    },
    schemas: {
      global: {
        domains: {
          rules: ["access", "read", "create", "modify", "delete"],
          custom: { "2fa": (accountId) => accountId === "has-2fa" },
        },
      },
      domain: {
        domain: { rules: ["access", "read", "modify"], bridgeFromGlobal: "domains" },
        recipients: { rules: ["access", "read"], dependsOn: [{ resource: "domain", action: "access" }] },
      },
    },
    ...overrides,
  });
}

describe("assertOne/assertAll — acrud", () => {
  let store: FakeStore;
  beforeEach(() => {
    store = createFakeStore();
  });

  it("denies when the account has zero groups and no ownership", async () => {
    const { assertOne } = createAssertions(testConfig(store));
    await expect(assertOne.global(1, "domains", { acrud: ["access"] })).rejects.toBeInstanceOf(TestForbiddenError);
  });

  it("denies read when access is missing even though a read row exists (acrud prerequisite)", async () => {
    seedGroupMembership(store, 1, 10);
    seedGlobalPermission(store, 10, "domains", "read");
    const { assertOne } = createAssertions(testConfig(store));
    await expect(assertOne.global(1, "domains", { acrud: ["read"] })).rejects.toBeInstanceOf(TestForbiddenError);
  });

  it("grants read when access + read are both present", async () => {
    seedGroupMembership(store, 1, 10);
    seedGlobalPermission(store, 10, "domains", "access");
    seedGlobalPermission(store, 10, "domains", "read");
    const { assertOne } = createAssertions(testConfig(store));
    await expect(assertOne.global(1, "domains", { acrud: ["read"] })).resolves.toBeUndefined();
  });

  it("grants via OR semantics when only one of several groups grants", async () => {
    seedGroupMembership(store, 1, 10);
    seedGroupMembership(store, 1, 20);
    seedGroupMembership(store, 1, 30);
    for (const groupId of [10, 20]) {
      seedGlobalPermission(store, groupId, "domains", "access");
      seedGlobalPermission(store, groupId, "domains", "read");
    }
    seedGlobalPermission(store, 30, "domains", "access");
    seedGlobalPermission(store, 30, "domains", "read");
    seedGlobalPermission(store, 30, "domains", "create");
    const { assertOne } = createAssertions(testConfig(store));
    await expect(assertOne.global(1, "domains", { acrud: ["create"] })).resolves.toBeUndefined();
  });

  it("denies when no group grants it, even with several groups present", async () => {
    seedGroupMembership(store, 1, 10);
    seedGroupMembership(store, 1, 20);
    seedGlobalPermission(store, 10, "domains", "access");
    seedGlobalPermission(store, 20, "domains", "access");
    const { assertOne } = createAssertions(testConfig(store));
    await expect(assertOne.global(1, "domains", { acrud: ["create"] })).rejects.toBeInstanceOf(TestForbiddenError);
  });

  it("behaves identically for a single group regardless of groupMode (single vs multiple)", async () => {
    seedGroupMembership(store, 1, 10);
    seedGlobalPermission(store, 10, "domains", "access");
    seedGlobalPermission(store, 10, "domains", "read");

    const single = createAssertions(testConfig(store, { groupMode: "single" }));
    const multiple = createAssertions(testConfig(store, { groupMode: "multiple" }));

    await expect(single.assertOne.global(1, "domains", { acrud: ["read"] })).resolves.toBeUndefined();
    await expect(multiple.assertOne.global(1, "domains", { acrud: ["read"] })).resolves.toBeUndefined();
  });
});

describe("assertOne/assertAll — domain tier bypasses and gate", () => {
  let store: FakeStore;
  beforeEach(() => {
    store = createFakeStore();
  });

  it("grants everything on an owned domain even with zero groups (ownership bypass)", async () => {
    seedOwnedDomain(store, 1, 7);
    const { assertOne } = createAssertions(testConfig(store));
    await expect(assertOne.domain(1, 7, "recipients", { acrud: ["access", "read"] })).resolves.toBeUndefined();
  });

  it("does not extend ownership of one domain to a different domainId", async () => {
    seedOwnedDomain(store, 1, 7);
    const { assertOne } = createAssertions(testConfig(store));
    await expect(assertOne.domain(1, 9, "recipients", { acrud: ["access"] })).rejects.toBeInstanceOf(TestForbiddenError);
  });

  it("bridges a domain-tier resource from its declared global resource, on any domainId, without a dedicated row", async () => {
    seedGroupMembership(store, 1, 10);
    seedGlobalPermission(store, 10, "domains", "access");
    seedGlobalPermission(store, 10, "domains", "modify");
    const { assertOne } = createAssertions(testConfig(store));
    await expect(assertOne.domain(1, 999, "domain", { acrud: ["modify"] })).resolves.toBeUndefined();
  });

  it("does not leak the bridge's grant into a sibling resource's own acrud", async () => {
    seedGroupMembership(store, 1, 10);
    seedGlobalPermission(store, 10, "domains", "access");
    seedGlobalPermission(store, 10, "domains", "modify");
    const { assertOne } = createAssertions(testConfig(store));
    // dependsOn(domain:access) passes via the bridge, but recipients has no
    // group_domain_permissions row of its own on domain 999 — still denied.
    await expect(assertOne.domain(1, 999, "recipients", { acrud: ["access"] })).rejects.toBeInstanceOf(TestForbiddenError);
  });

  it("satisfies dependsOn recursively via the dependency's own bridge, unblocking the dependent resource's own rows", async () => {
    seedGroupMembership(store, 1, 10);
    seedGlobalPermission(store, 10, "domains", "access");
    seedGlobalPermission(store, 10, "domains", "modify"); // bridge active for "domain"
    seedDomainPermission(store, 10, 999, "recipients", "access"); // recipients' own row
    const { assertOne } = createAssertions(testConfig(store));
    await expect(assertOne.domain(1, 999, "recipients", { acrud: ["access"] })).resolves.toBeUndefined();
  });

  it("gates on dependsOn: denies the dependent resource when domain:access is missing, even if its own rows exist", async () => {
    seedGroupMembership(store, 1, 10);
    seedDomainPermission(store, 10, 7, "recipients", "access");
    seedDomainPermission(store, 10, 7, "recipients", "read");
    const { assertOne } = createAssertions(testConfig(store));
    await expect(assertOne.domain(1, 7, "recipients", { acrud: ["read"] })).rejects.toBeInstanceOf(TestForbiddenError);
  });

  it("grants the dependent resource once domain:access is itself granted via a group row", async () => {
    seedGroupMembership(store, 1, 10);
    seedDomainPermission(store, 10, 7, "domain", "access");
    seedDomainPermission(store, 10, 7, "recipients", "access");
    seedDomainPermission(store, 10, 7, "recipients", "read");
    const { assertOne } = createAssertions(testConfig(store));
    await expect(assertOne.domain(1, 7, "recipients", { acrud: ["read"] })).resolves.toBeUndefined();
  });
});

describe("assertOne/assertAll — custom checks", () => {
  let store: FakeStore;
  beforeEach(() => {
    store = createFakeStore();
  });

  it("grants when the custom predicate returns true", async () => {
    const { assertOne } = createAssertions(testConfig(store));
    await expect(assertOne.global("has-2fa", "domains", { custom: ["2fa"] })).resolves.toBeUndefined();
  });

  it("denies when the custom predicate returns false", async () => {
    const { assertOne } = createAssertions(testConfig(store));
    await expect(assertOne.global("no-2fa", "domains", { custom: ["2fa"] })).rejects.toBeInstanceOf(TestForbiddenError);
  });
});

describe("assertOne/assertAll — misconfiguration surfaces a distinct config error, never onForbidden", () => {
  let store: FakeStore;
  beforeEach(() => {
    store = createFakeStore();
  });

  it("throws CustomPermissionGuardConfigError for an unknown global resource", async () => {
    const { assertOne } = createAssertions(testConfig(store));
    await expect(assertOne.global(1, "typo-resource", { acrud: ["access"] })).rejects.toBeInstanceOf(
      CustomPermissionGuardConfigError
    );
  });

  it("throws CustomPermissionGuardConfigError for an unknown action on a known resource", async () => {
    const { assertOne } = createAssertions(testConfig(store));
    await expect(assertOne.global(1, "domains", { acrud: ["typo-action"] })).rejects.toBeInstanceOf(
      CustomPermissionGuardConfigError
    );
  });

  it("throws CustomPermissionGuardConfigError for an unknown custom check", async () => {
    const { assertOne } = createAssertions(testConfig(store));
    await expect(assertOne.global(1, "domains", { custom: ["typo-check"] })).rejects.toBeInstanceOf(
      CustomPermissionGuardConfigError
    );
  });
});

describe("assertOne/assertAll — authorizedPermissions kill-switch", () => {
  let store: FakeStore;
  beforeEach(() => {
    store = createFakeStore();
  });

  it("throws a config error for a disabled tier+dimension regardless of schemas", async () => {
    const config = testConfig(store, {
      authorizedPermissions: {
        global: { acrud: true, custom: false },
        domain: { acrud: true, custom: true },
      },
    });
    const { assertOne } = createAssertions(config);
    await expect(assertOne.global("has-2fa", "domains", { custom: ["2fa"] })).rejects.toBeInstanceOf(
      CustomPermissionGuardConfigError
    );
  });

  it("leaves other tier+dimension combinations unaffected", async () => {
    seedGroupMembership(store, 1, 10);
    seedGlobalPermission(store, 10, "domains", "access");
    const config = testConfig(store, {
      authorizedPermissions: {
        global: { acrud: true, custom: false },
        domain: { acrud: true, custom: true },
      },
    });
    const { assertOne } = createAssertions(config);
    await expect(assertOne.global(1, "domains", { acrud: ["access"] })).resolves.toBeUndefined();
  });
});

describe("assertOne — sugar over assertAll", () => {
  let store: FakeStore;
  beforeEach(() => {
    store = createFakeStore();
  });

  it("checks both acrud and custom in a single call when both are supplied", async () => {
    seedGroupMembership(store, "has-2fa", 10);
    seedGlobalPermission(store, 10, "domains", "access");
    const { assertOne } = createAssertions(testConfig(store));
    await expect(assertOne.global("has-2fa", "domains", { acrud: ["access"], custom: ["2fa"] })).resolves.toBeUndefined();
  });

  it("fails on the custom leg even if the acrud leg would pass", async () => {
    seedGroupMembership(store, "no-2fa", 10);
    seedGlobalPermission(store, 10, "domains", "access");
    const { assertOne } = createAssertions(testConfig(store));
    await expect(assertOne.global("no-2fa", "domains", { acrud: ["access"], custom: ["2fa"] })).rejects.toBeInstanceOf(
      TestForbiddenError
    );
  });
});
