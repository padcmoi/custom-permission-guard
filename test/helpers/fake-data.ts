import type { AccountId, CustomPermissionGuardConfig } from "../../src/types.js";

interface FakeGroup {
  name: string;
  description: string | null;
  ownerId: AccountId | null;
  isDefault: boolean;
  createdAt: Date;
}

export interface FakeStore {
  accountGroups: Map<AccountId, Set<number>>;
  globalPermissions: Map<number, { resource: string; action: string }[]>;
  domainPermissions: Map<number, { domainId: number; resource: string; action: string }[]>;
  ownedDomains: Map<AccountId, Set<number>>;
  groups: Map<number, FakeGroup>;
  nextGroupId: number;
  defaultGroupId: number | null;
}

export function createFakeStore() {
  return {
    accountGroups: new Map<AccountId, Set<number>>(),
    globalPermissions: new Map<number, { resource: string; action: string }[]>(),
    domainPermissions: new Map<number, { domainId: number; resource: string; action: string }[]>(),
    ownedDomains: new Map<AccountId, Set<number>>(),
    groups: new Map<number, FakeGroup>(),
    nextGroupId: 1,
    defaultGroupId: null as number | null,
  };
}

export function seedGlobalPermission(store: FakeStore, groupId: number, resource: string, action: string) {
  const list = store.globalPermissions.get(groupId) ?? [];
  list.push({ resource, action });
  store.globalPermissions.set(groupId, list);
}

export function seedDomainPermission(store: FakeStore, groupId: number, domainId: number, resource: string, action: string) {
  const list = store.domainPermissions.get(groupId) ?? [];
  list.push({ domainId, resource, action });
  store.domainPermissions.set(groupId, list);
}

export function seedGroupMembership(store: FakeStore, accountId: AccountId, groupId: number) {
  const set = store.accountGroups.get(accountId) ?? new Set<number>();
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
    findGlobalPermissions(groupId: number) {
      return Promise.resolve(store.globalPermissions.get(groupId) ?? []);
    },
    findDomainPermissions(groupId: number) {
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
    findGroup(groupId: number) {
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
    updateGroup(groupId: number, changes: { name?: string; description?: string }) {
      const g = store.groups.get(groupId);
      if (g) {
        if (changes.name !== undefined) g.name = changes.name;
        if (changes.description !== undefined) g.description = changes.description;
      }
      return Promise.resolve();
    },
    setGroupOwner(groupId: number, accountId: AccountId | null) {
      const g = store.groups.get(groupId);
      if (g) g.ownerId = accountId;
      return Promise.resolve();
    },
    deleteGroup(groupId: number) {
      store.groups.delete(groupId);
      store.globalPermissions.delete(groupId);
      store.domainPermissions.delete(groupId);
      for (const set of store.accountGroups.values()) set.delete(groupId);
      return Promise.resolve();
    },

    setGroupGlobalPermissions(groupId: number, permissions: { resource: string; action: string }[]) {
      store.globalPermissions.set(groupId, permissions);
      return Promise.resolve();
    },
    setGroupDomainPermissions(groupId: number, permissions: { domainId: number; resource: string; action: string }[]) {
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

    assignAccountToGroup(accountId: AccountId, groupId: number) {
      const set = store.accountGroups.get(accountId) ?? new Set<number>();
      set.add(groupId);
      store.accountGroups.set(accountId, set);
      return Promise.resolve();
    },
    findGroupMemberIds(groupId: number) {
      return Promise.resolve(
        [...store.accountGroups.entries()].filter(([, s]) => s.has(groupId)).map(([accountId]) => accountId)
      );
    },
    removeAccountFromGroup(accountId: AccountId, groupId: number) {
      store.accountGroups.get(accountId)?.delete(groupId);
      return Promise.resolve();
    },

    setDefaultGroup(groupId: number | null) {
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
