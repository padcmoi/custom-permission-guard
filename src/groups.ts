import { assertLockoutSafe } from "./group-permissions.js";
import type { AccountId, CustomPermissionGuardConfig } from "./types.js";

// CRUD/membership/default-group entity management. name/description/ownerId/
// isDefault are pure data here, opaque to the lib — never used to compute a
// permission (unlike domain ownership). Mostly thin pass-throughs to data.*;
// deleteGroup is the one exception, since removing a lockoutProtected
// group's last holder would otherwise bypass the anti-lockout invariant that
// setGroupGlobalPermissions enforces on edits.
export function createGroups(config: CustomPermissionGuardConfig) {
  return {
    async listGroups() {
      return config.data.listGroups();
    },

    async findGroup(groupId: number) {
      return config.data.findGroup(groupId);
    },

    async createGroup(name: string) {
      return config.data.createGroup(name);
    },

    async updateGroup(groupId: number, changes: { name?: string; description?: string }) {
      await config.data.updateGroup(groupId, changes);
    },

    async deleteGroup(groupId: number) {
      // Equivalent to replacing this group's global permissions with [] —
      // same anti-lockout check a setGroupGlobalPermissions edit would get,
      // so deletion can't be used to route around the invariant.
      await assertLockoutSafe(config, groupId, []);
      await config.data.deleteGroup(groupId);
    },

    async setGroupOwner(groupId: number, accountId: AccountId | null) {
      await config.data.setGroupOwner(groupId, accountId);
    },

    async assignAccountToGroup(accountId: AccountId, groupId: number) {
      await config.data.assignAccountToGroup(accountId, groupId);
    },

    async removeAccountFromGroup(accountId: AccountId, groupId: number) {
      await config.data.removeAccountFromGroup(accountId, groupId);
    },

    async findGroupMemberIds(groupId: number) {
      return config.data.findGroupMemberIds(groupId);
    },

    async setDefaultGroup(groupId: number | null) {
      await config.data.setDefaultGroup(groupId);
    },

    async onAccountCreated(accountId: AccountId) {
      const defaultGroupId = await config.data.findDefaultGroupId();
      if (defaultGroupId === null) return null;
      await config.data.assignAccountToGroup(accountId, defaultGroupId);
      return defaultGroupId;
    },
  };
}
