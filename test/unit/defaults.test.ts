import { describe, expect, it } from "vitest";
import { defaultValueCustomPermissionGuard, mergeWithDefaults } from "../../src/defaults.js";

describe("mergeWithDefaults", () => {
  const onForbidden = (reason: string) => {
    throw new Error(reason);
  };
  const data = {} as never;

  it("falls back to defaults for every optional field when omitted", () => {
    const config = mergeWithDefaults({ onForbidden, data });
    expect(config.groupMode).toBe(defaultValueCustomPermissionGuard.groupMode);
    expect(config.authorizedPermissions).toEqual(defaultValueCustomPermissionGuard.authorizedPermissions);
    expect(config.schemas).toEqual(defaultValueCustomPermissionGuard.schemas);
    expect(config.lockoutProtected).toBeUndefined();
  });

  it("keeps onForbidden and data exactly as provided", () => {
    const config = mergeWithDefaults({ onForbidden, data });
    expect(config.onForbidden).toBe(onForbidden);
    expect(config.data).toBe(data);
  });

  it("uses the user's value instead of the default when supplied", () => {
    const schemas = { global: { domains: { rules: ["access"] } }, domain: {} };
    const config = mergeWithDefaults({
      onForbidden,
      data,
      groupMode: "multiple",
      lockoutProtected: [{ resource: "groups", actions: ["access"] }],
      schemas,
    });
    expect(config.groupMode).toBe("multiple");
    expect(config.schemas).toBe(schemas);
    expect(config.lockoutProtected).toEqual([{ resource: "groups", actions: ["access"] }]);
  });
});
