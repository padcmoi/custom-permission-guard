export type AccountId = number | string;

// Unlike AccountId, group IDs used to be lib-owned (always createGroup()'s
// own auto-increment) -- widened to match AccountId's shape since a consumer
// may back groups with the same non-numeric ID scheme as accounts (UUID,
// ObjectId, ...).
export type GroupId = number | string;

export interface AcrudRequirement {
  resource: string;
  acrud?: string[];
}

export interface CustomRequirement {
  resource: string;
  custom?: string[];
}

export interface GroupSummary {
  id: GroupId;
  name: string;
  description: string | null;
  ownerId: AccountId | null;
  isDefault: boolean;
  // A protected group can never be deleted, by anyone (deleteGroup refuses it).
  // Who may toggle the flag is the consumer's policy, not the lib's.
  protected: boolean;
  memberCount: number;
  createdAt: Date;
}

export interface GroupDetail {
  id: GroupId;
  name: string;
  description: string | null;
  ownerId: AccountId | null;
  isDefault: boolean;
  protected: boolean;
  createdAt: Date;
}

export interface GlobalResourceSchema {
  rules: string[];
  custom?: Record<string, (accountId: AccountId) => boolean>;
  // Gate (not a bypass): each {resource, action} must also be granted
  // globally, checked recursively, before this resource's own acrud is even
  // evaluated. Same contract as DomainResourceSchema's dependsOn below, minus
  // the ownership/bridge bypasses that only exist at the domain tier.
  dependsOn?: { resource: string; action: string }[];
}

export interface DomainResourceSchema {
  rules: string[];
  custom?: Record<string, (accountId: AccountId) => boolean>;
  // Grants this domain-tier resource on ANY domainId when the named GLOBAL
  // resource's access+action is held. Enforcement-only bypass (assertOne/
  // assertAll) — deliberately never synthesized in getEffectivePermissions,
  // which can only represent finite (domainId, resource, action) rows.
  bridgeFromGlobal?: string;
  // Gate (not a bypass): each {resource, action} must also be granted on the
  // SAME domainId, checked recursively (benefits from the dependency's own
  // ownership/bridge), before this resource's own acrud is even evaluated.
  dependsOn?: { resource: string; action: string }[];
}

// Input/output of utils.diffPermissions. A permission set is what a full-replace
// edit writes; the diff reports the rows added and removed, per tier.
export interface PermissionSet {
  global?: { resource: string; action: string }[];
  domain?: { domainId: number; resource: string; action: string }[];
}

export interface PermissionSetDiff {
  added: {
    global: { resource: string; action: string }[];
    domain: { domainId: number; resource: string; action: string }[];
  };
  removed: {
    global: { resource: string; action: string }[];
    domain: { domainId: number; resource: string; action: string }[];
  };
}

export interface CustomPermissionGuard {
  assertOne: {
    global(accountId: AccountId, resource: string, requirements: { acrud?: string[]; custom?: string[] }): Promise<void>;
    domain(
      accountId: AccountId,
      domainId: number,
      resource: string,
      requirements: { acrud?: string[]; custom?: string[] }
    ): Promise<void>;
  };

  assertAll: {
    global: {
      acrud(accountId: AccountId, requirements: AcrudRequirement[]): Promise<void>;
      custom(accountId: AccountId, requirements: CustomRequirement[]): Promise<void>;
    };
    domain: {
      acrud(accountId: AccountId, domainId: number, requirements: AcrudRequirement[]): Promise<void>;
      custom(accountId: AccountId, domainId: number, requirements: CustomRequirement[]): Promise<void>;
    };
  };

  // Optional convenience helpers, deliberately namespaced apart from the core
  // assert*/group/membership surface so an app that never needs them can ignore
  // them. Nothing here is required to run the guard.
  utils: {
    // Non-throwing acrud query, the boolean sibling of assertOne: `true` when
    // the account effectively holds resource.action (same ownership/bridge/
    // dependsOn evaluation), `false` otherwise. A misconfiguration still throws
    // CustomPermissionGuardConfigError.
    check: {
      global(accountId: AccountId, resource: string, action: string): Promise<boolean>;
      domain(accountId: AccountId, domainId: number, resource: string, action: string): Promise<boolean>;
    };

    // Anti-escalation primitive: returns the subset of `required` the account
    // does NOT hold (both arrays empty => it holds them all). Lets a consumer
    // enforce "you may only grant permissions you hold yourself" without the lib
    // knowing anything about grouping, ownership of the grant, or who counts as
    // root -- the consumer owns that decision (and any superuser bypass) here.
    findUnheldPermissions(
      accountId: AccountId,
      required: {
        global?: { resource: string; action: string }[];
        domain?: { domainId: number; resource: string; action: string }[];
      }
    ): Promise<{
      global: { resource: string; action: string }[];
      domain: { domainId: number; resource: string; action: string }[];
    }>;

    // Pure set difference between a group's current permission set and the one a
    // full-replace edit would write: which rows are added, which removed, per
    // tier. Pair it with findUnheldPermissions to enforce anti-escalation on the
    // CHANGE only (an untouched permission the actor lacks passes through). It
    // reports facts, not policy: whether revoking a permission you lack is
    // allowed is yours to decide, hence added/removed are returned separately.
    diffPermissions(before: PermissionSet, after: PermissionSet): PermissionSetDiff;
  };

  getEffectivePermissions(accountId: AccountId): Promise<{
    global: { resource: string; action: string }[];
    domain: { domainId: number; resource: string; action: string }[];
  }>;

  listGroups(): Promise<GroupSummary[]>;
  findGroup(groupId: GroupId): Promise<GroupDetail | null>;
  createGroup(name: string): Promise<GroupId>;
  updateGroup(groupId: GroupId, changes: { name?: string; description?: string }): Promise<void>;
  // Refuses (via onForbidden) when the group is protected, otherwise deletes.
  deleteGroup(groupId: GroupId): Promise<void>;
  setGroupOwner(groupId: GroupId, accountId: AccountId | null): Promise<void>;
  // Toggle the protection flag. Absolute against deletion once set; the lib does
  // not gate WHO may call this (e.g. root-only), that stays the consumer's job.
  setGroupProtected(groupId: GroupId, isProtected: boolean): Promise<void>;

  findGroupGlobalPermissions(groupId: GroupId): Promise<{ resource: string; action: string }[]>;
  findGroupDomainPermissions(groupId: GroupId): Promise<{ domainId: number; resource: string; action: string }[]>;
  setGroupGlobalPermissions(groupId: GroupId, permissions: { resource: string; action: string }[]): Promise<void>;
  setGroupDomainPermissions(
    groupId: GroupId,
    permissions: { domainId: number; resource: string; action: string }[]
  ): Promise<void>;

  assignAccountToGroup(accountId: AccountId, groupId: GroupId): Promise<void>;
  removeAccountFromGroup(accountId: AccountId, groupId: GroupId): Promise<void>;
  findGroupMemberIds(groupId: GroupId): Promise<AccountId[]>;

  setDefaultGroup(groupId: GroupId | null): Promise<void>;
  onAccountCreated(accountId: AccountId): Promise<GroupId | null>;
}

// Public input to createCustomPermissionGuard: onForbidden/data are mandatory
// (no sensible default exists for either), everything else falls back to
// defaultValueCustomPermissionGuard (see defaults.ts) when omitted.
export type CustomPermissionGuardUserConfig = Pick<CustomPermissionGuardConfig, "onForbidden" | "data"> &
  Partial<Pick<CustomPermissionGuardConfig, "groupMode" | "authorizedPermissions" | "schemas" | "lockoutProtected">>;

export interface CustomPermissionGuardConfig {
  onForbidden(reason: string): never;

  groupMode: "single" | "multiple";

  // Enforcement kill-switch, checked before schemas: when
  // authorizedPermissions.<tier>.<dimension> is false, any assertOne/assertAll
  // call for that tier+dimension throws CustomPermissionGuardConfigError
  // immediately, regardless of what schemas declares.
  authorizedPermissions: {
    global: { acrud: boolean; custom: boolean };
    domain: { acrud: boolean; custom: boolean };
  };

  schemas: {
    global: Record<string, GlobalResourceSchema>;
    domain: Record<string, DomainResourceSchema>;
  };

  // setGroupGlobalPermissions/deleteGroup refuse (onForbidden) any write that
  // would leave zero groups system-wide holding ALL of these actions on this
  // global resource at the same time. Global tier only.
  lockoutProtected?: { resource: string; actions: string[] }[];

  data: {
    findAccountGroupIds(accountId: AccountId): Promise<GroupId[]>;
    findGlobalPermissions(groupId: GroupId): Promise<{ resource: string; action: string }[]>;
    findDomainPermissions(groupId: GroupId): Promise<{ domainId: number; resource: string; action: string }[]>;
    findOwnedDomainIds(accountId: AccountId): Promise<number[]>;

    createGroup(name: string): Promise<GroupId>;
    listGroups(): Promise<GroupSummary[]>;
    findGroup(groupId: GroupId): Promise<GroupDetail | null>;
    updateGroup(groupId: GroupId, changes: { name?: string; description?: string }): Promise<void>;
    setGroupOwner(groupId: GroupId, accountId: AccountId | null): Promise<void>;
    deleteGroup(groupId: GroupId): Promise<void>;
    // Read/write the per-group protection flag. findGroupProtected backs the
    // deleteGroup guard; setGroupProtected persists a toggle.
    findGroupProtected(groupId: GroupId): Promise<boolean>;
    setGroupProtected(groupId: GroupId, isProtected: boolean): Promise<void>;

    setGroupGlobalPermissions(groupId: GroupId, permissions: { resource: string; action: string }[]): Promise<void>;
    setGroupDomainPermissions(
      groupId: GroupId,
      permissions: { domainId: number; resource: string; action: string }[]
    ): Promise<void>;
    countGroupsWithGlobalPermission(resource: string, actions: string[]): Promise<number>;

    assignAccountToGroup(accountId: AccountId, groupId: GroupId): Promise<void>;
    findGroupMemberIds(groupId: GroupId): Promise<AccountId[]>;
    removeAccountFromGroup(accountId: AccountId, groupId: GroupId): Promise<void>;

    setDefaultGroup(groupId: GroupId | null): Promise<void>;
    findDefaultGroupId(): Promise<GroupId | null>;
  };
}
