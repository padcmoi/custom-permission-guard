import type { CustomPermissionGuardConfig } from "./types.js";

// Access-prerequisite cleanup, grouped by resource: any resource without an
// "access" entry in THIS write loses all its other entries too — never an
// orphaned read/create/modify/delete stored without its own access.
function stripOrphanedGlobal(permissions: { resource: string; action: string }[]) {
  const byResource = new Map<string, { resource: string; action: string }[]>();
  for (const p of permissions) {
    const list = byResource.get(p.resource) ?? [];
    list.push(p);
    byResource.set(p.resource, list);
  }
  const cleaned: { resource: string; action: string }[] = [];
  for (const entries of byResource.values()) {
    if (entries.some((e) => e.action === "access")) cleaned.push(...entries);
  }
  return cleaned;
}

// Same cleanup, grouped by (domainId, resource) instead of just resource — a
// resource can hold access on domain 7 but not domain 9 for the same group.
function stripOrphanedDomain(permissions: { domainId: number; resource: string; action: string }[]) {
  const byKey = new Map<string, { domainId: number; resource: string; action: string }[]>();
  for (const p of permissions) {
    const key = `${p.domainId}:${p.resource}`;
    const list = byKey.get(key) ?? [];
    list.push(p);
    byKey.set(key, list);
  }
  const cleaned: { domainId: number; resource: string; action: string }[] = [];
  for (const entries of byKey.values()) {
    if (entries.some((e) => e.action === "access")) cleaned.push(...entries);
  }
  return cleaned;
}

// Cross-group invariant: no per-account primitive can express "count every
// group system-wide", so this lives in the lib rather than being composable
// by the consumer (unlike anti-escalation, which stays the consumer's job).
// `newGlobalPermissions` is the FULL new state for groupId — pass [] to
// evaluate a group deletion the same way as a full-wipe permission write.
export async function assertLockoutSafe(
  config: CustomPermissionGuardConfig,
  groupId: number,
  newGlobalPermissions: { resource: string; action: string }[]
) {
  const protectedEntries = config.lockoutProtected ?? [];
  if (protectedEntries.length === 0) return;

  const before = await config.data.findGlobalPermissions(groupId);
  for (const { resource, actions } of protectedEntries) {
    const hadAll = actions.every((a) => before.some((p) => p.resource === resource && p.action === a));
    if (!hadAll) continue; // this group never held the full combo, nothing to protect

    const willHaveAll = actions.every((a) => newGlobalPermissions.some((p) => p.resource === resource && p.action === a));
    if (willHaveAll) continue; // still holds it after the write, no risk

    const count = await config.data.countGroupsWithGlobalPermission(resource, actions);
    if (count <= 1) {
      config.onForbidden(`would lock out ${resource}.[${actions.join(",")}] system-wide`);
    }
  }
}

export function createGroupPermissions(config: CustomPermissionGuardConfig) {
  return {
    async findGroupGlobalPermissions(groupId: number) {
      return config.data.findGlobalPermissions(groupId);
    },

    async findGroupDomainPermissions(groupId: number) {
      return config.data.findDomainPermissions(groupId);
    },

    async setGroupGlobalPermissions(groupId: number, permissions: { resource: string; action: string }[]) {
      const cleaned = stripOrphanedGlobal(permissions);
      await assertLockoutSafe(config, groupId, cleaned);
      await config.data.setGroupGlobalPermissions(groupId, cleaned);
    },

    async setGroupDomainPermissions(groupId: number, permissions: { domainId: number; resource: string; action: string }[]) {
      const cleaned = stripOrphanedDomain(permissions);
      await config.data.setGroupDomainPermissions(groupId, cleaned);
    },
  };
}
