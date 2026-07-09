import type { AccountId, CustomPermissionGuardConfig, GroupId } from "../../src/types.js";

interface FakeGroup {
  name: string;
  description: string | null;
  ownerId: AccountId | null;
  isDefault: boolean;
  createdAt: Date;
}

export interface FakeStore {
  accountGroups: Map<AccountId, Set<GroupId>>;
  globalPermissions: Map<GroupId, { resource: string; action: string }[]>;
  domainPermissions: Map<GroupId, { domainId: number; resource: string; action: string }[]>;
  ownedDomains: Map<AccountId, Set<number>>;
  groups: Map<GroupId, FakeGroup>;
  nextGroupId: number;
  defaultGroupId: GroupId | null;
}

export function createFakeStore() {
  return {
    accountGroups: new Map<AccountId, Set<GroupId>>(),
    globalPermissions: new Map<GroupId, { resource: string; action: string }[]>(),
    domainPermissions: new Map<GroupId, { domainId: number; resource: string; action: string }[]>(),
    ownedDomains: new Map<AccountId, Set<number>>(),
    groups: new Map<GroupId, FakeGroup>(),
    nextGroupId: 1,
    defaultGroupId: null as GroupId | null,
  };
}

export function seedGlobalPermission(store: FakeStore, groupId: GroupId, resource: string, action: string) {
  const list = store.globalPermissions.get(groupId) ?? [];
  list.push({ resource, action });
  store.globalPermissions.set(groupId, list);
}

export function seedDomainPermission(store: FakeStore, groupId: GroupId, domainId: number, resource: string, action: string) {
  const list = store.domainPermissions.get(groupId) ?? [];
  list.push({ domainId, resource, action });
  store.domainPermissions.set(groupId, list);
}

export function seedGroupMembership(store: FakeStore, accountId: AccountId, groupId: GroupId) {
  const set = store.accountGroups.get(accountId) ?? new Set<GroupId>();
  set.add(groupId);
  store.accountGroups.set(accountId, set);
}

export function seedOwnedDomain(store: FakeStore, accountId: AccountId, domainId: number) {
  const set = store.ownedDomains.get(accountId) ?? new Set<number>();
  set.add(domainId);
  store.ownedDomains.set(accountId, set);
}

// Full in-memory implementation of CustomPermissionGuardConfig["data"] over a
// FakeStore — never persisted anywhere, so tests inspect `store` directly to
// assert on side effects instead of a real database. Plain (non-async)
// methods returning Promise.resolve(...): everything here is a synchronous
// Map/Set operation, so `async` with no `await` inside would just trip
// require-await for no benefit.
export function createFakeData(store: FakeStore) {
  return {
    findAccountGroupIds(accountId: AccountId) {
      return Promise.resolve([...(store.accountGroups.get(accountId) ?? [])]);
    },
    findGlobalPermissions(groupId: GroupId) {
      return Promise.resolve(store.globalPermissions.get(groupId) ?? []);
    },
    findDomainPermissions(groupId: GroupId) {
      return Promise.resolve(store.domainPermissions.get(groupId) ?? []);
    },
    findOwnedDomainIds(accountId: AccountId) {
      return Promise.resolve([...(store.ownedDomains.get(accountId) ?? [])]);
    },

    createGroup(name: string) {
      const id = store.nextGroupId++;
      store.groups.set(id, { name, description: null, ownerId: null, isDefault: false, createdAt: new Date() });
      return Promise.resolve(id);
    },
    listGroups() {
      return Promise.resolve(
        [...store.groups.entries()].map(([id, g]) => ({
          id,
          name: g.name,
          description: g.description,
          ownerId: g.ownerId,
          isDefault: g.isDefault,
          memberCount: [...store.accountGroups.values()].filter((s) => s.has(id)).length,
          createdAt: g.createdAt,
        }))
      );
    },
    findGroup(groupId: GroupId) {
      const g = store.groups.get(groupId);
      if (!g) return Promise.resolve(null);
      return Promise.resolve({
        id: groupId,
        name: g.name,
        description: g.description,
        ownerId: g.ownerId,
        isDefault: g.isDefault,
        createdAt: g.createdAt,
      });
    },
    updateGroup(groupId: GroupId, changes: { name?: string; description?: string }) {
      const g = store.groups.get(groupId);
      if (g) {
        if (changes.name !== undefined) g.name = changes.name;
        if (changes.description !== undefined) g.description = changes.description;
      }
      return Promise.resolve();
    },
    setGroupOwner(groupId: GroupId, accountId: AccountId | null) {
      const g = store.groups.get(groupId);
      if (g) g.ownerId = accountId;
      return Promise.resolve();
    },
    deleteGroup(groupId: GroupId) {
      store.groups.delete(groupId);
      store.globalPermissions.delete(groupId);
      store.domainPermissions.delete(groupId);
      for (const set of store.accountGroups.values()) set.delete(groupId);
      return Promise.resolve();
    },

    setGroupGlobalPermissions(groupId: GroupId, permissions: { resource: string; action: string }[]) {
      store.globalPermissions.set(groupId, permissions);
      return Promise.resolve();
    },
    setGroupDomainPermissions(groupId: GroupId, permissions: { domainId: number; resource: string; action: string }[]) {
      store.domainPermissions.set(groupId, permissions);
      return Promise.resolve();
    },
    countGroupsWithGlobalPermission(resource: string, actions: string[]) {
      let count = 0;
      for (const perms of store.globalPermissions.values()) {
        if (actions.every((a) => perms.some((p) => p.resource === resource && p.action === a))) count++;
      }
      return Promise.resolve(count);
    },

    assignAccountToGroup(accountId: AccountId, groupId: GroupId) {
      const set = store.accountGroups.get(accountId) ?? new Set<GroupId>();
      set.add(groupId);
      store.accountGroups.set(accountId, set);
      return Promise.resolve();
    },
    findGroupMemberIds(groupId: GroupId) {
      return Promise.resolve(
        [...store.accountGroups.entries()].filter(([, s]) => s.has(groupId)).map(([accountId]) => accountId)
      );
    },
    removeAccountFromGroup(accountId: AccountId, groupId: GroupId) {
      store.accountGroups.get(accountId)?.delete(groupId);
      return Promise.resolve();
    },

    setDefaultGroup(groupId: GroupId | null) {
      if (store.defaultGroupId !== null) {
        const prev = store.groups.get(store.defaultGroupId);
        if (prev) prev.isDefault = false;
      }
      store.defaultGroupId = groupId;
      if (groupId !== null) {
        const g = store.groups.get(groupId);
        if (g) g.isDefault = true;
      }
      return Promise.resolve();
    },
    findDefaultGroupId() {
      return Promise.resolve(store.defaultGroupId);
    },
  } satisfies CustomPermissionGuardConfig["data"];
}
