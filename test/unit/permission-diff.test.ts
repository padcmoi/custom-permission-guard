import { describe, expect, it } from "vitest";
import { diffPermissions } from "../../src/permission-diff.js";

describe("diffPermissions", () => {
  it("reports nothing changed when before and after are identical", () => {
    const set = {
      global: [{ resource: "sieve", action: "access" }],
      domain: [{ domainId: 1, resource: "recipients", action: "read" }],
    };
    const diff = diffPermissions(set, { global: [...set.global], domain: [...set.domain] });
    expect(diff).toEqual({
      added: { global: [], domain: [] },
      removed: { global: [], domain: [] },
    });
  });

  it("splits added and removed on the global tier", () => {
    const before = { global: [{ resource: "sieve", action: "access" }] };
    const after = {
      global: [
        { resource: "sieve", action: "access" }, // untouched
        { resource: "postfix", action: "access" }, // added
      ],
    };
    // sieve unchanged, postfix added, nothing removed
    const diff = diffPermissions(before, after);
    expect(diff.added.global).toEqual([{ resource: "postfix", action: "access" }]);
    expect(diff.removed.global).toEqual([]);
  });

  it("reports a removed global permission", () => {
    const before = {
      global: [
        { resource: "sieve", action: "access" },
        { resource: "postfix", action: "access" },
      ],
    };
    const after = { global: [{ resource: "postfix", action: "access" }] };
    const diff = diffPermissions(before, after);
    expect(diff.added.global).toEqual([]);
    expect(diff.removed.global).toEqual([{ resource: "sieve", action: "access" }]);
  });

  it("diffs the domain tier by (domainId, resource, action)", () => {
    const before = { domain: [{ domainId: 1, resource: "recipients", action: "read" }] };
    const after = {
      domain: [
        { domainId: 1, resource: "recipients", action: "read" }, // untouched
        { domainId: 2, resource: "recipients", action: "read" }, // added: same resource/action, other domain
      ],
    };
    const diff = diffPermissions(before, after);
    expect(diff.added.domain).toEqual([{ domainId: 2, resource: "recipients", action: "read" }]);
    expect(diff.removed.domain).toEqual([]);
  });

  it("treats an omitted tier as empty on both sides", () => {
    const diff = diffPermissions({}, { global: [{ resource: "sieve", action: "access" }] });
    expect(diff.added.global).toEqual([{ resource: "sieve", action: "access" }]);
    expect(diff.added.domain).toEqual([]);
    expect(diff.removed.global).toEqual([]);
    expect(diff.removed.domain).toEqual([]);
  });
});
