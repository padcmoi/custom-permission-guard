export type AccountId = number | string;

export interface AcrudRequirement {
  resource: string;
  acrud?: string[];
}

export interface CustomRequirement {
  resource: string;
  custom?: string[];
}

export interface GroupSummary {
  id: number;
  name: string;
  description: string | null;
  ownerId: AccountId | null;
  isDefault: boolean;
  memberCount: number;
  createdAt: Date;
}

export interface GroupDetail {
  id: number;
  name: string;
  description: string | null;
  ownerId: AccountId | null;
  isDefault: boolean;
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

  getEffectivePermissions(accountId: AccountId): Promise<{
    global: { resource: string; action: string }[];
    domain: { domainId: number; resource: string; action: string }[];
  }>;

  listGroups(): Promise<GroupSummary[]>;
  findGroup(groupId: number): Promise<GroupDetail | null>;
  createGroup(name: string): Promise<number>;
  updateGroup(groupId: number, changes: { name?: string; description?: string }): Promise<void>;
  deleteGroup(groupId: number): Promise<void>;
  setGroupOwner(groupId: number, accountId: AccountId | null): Promise<void>;

  findGroupGlobalPermissions(groupId: number): Promise<{ resource: string; action: string }[]>;
  findGroupDomainPermissions(groupId: number): Promise<{ domainId: number; resource: string; action: string }[]>;
  setGroupGlobalPermissions(groupId: number, permissions: { resource: string; action: string }[]): Promise<void>;
  setGroupDomainPermissions(
    groupId: number,
    permissions: { domainId: number; resource: string; action: string }[]
  ): Promise<void>;

  assignAccountToGroup(accountId: AccountId, groupId: number): Promise<void>;
  removeAccountFromGroup(accountId: AccountId, groupId: number): Promise<void>;
  findGroupMemberIds(groupId: number): Promise<AccountId[]>;

  setDefaultGroup(groupId: number | null): Promise<void>;
  onAccountCreated(accountId: AccountId): Promise<number | null>;
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
    findAccountGroupIds(accountId: AccountId): Promise<number[]>;
    findGlobalPermissions(groupId: number): Promise<{ resource: string; action: string }[]>;
    findDomainPermissions(groupId: number): Promise<{ domainId: number; resource: string; action: string }[]>;
    findOwnedDomainIds(accountId: AccountId): Promise<number[]>;

    createGroup(name: string): Promise<number>;
    listGroups(): Promise<GroupSummary[]>;
    findGroup(groupId: number): Promise<GroupDetail | null>;
    updateGroup(groupId: number, changes: { name?: string; description?: string }): Promise<void>;
    setGroupOwner(groupId: number, accountId: AccountId | null): Promise<void>;
    deleteGroup(groupId: number): Promise<void>;

    setGroupGlobalPermissions(groupId: number, permissions: { resource: string; action: string }[]): Promise<void>;
    setGroupDomainPermissions(
      groupId: number,
      permissions: { domainId: number; resource: string; action: string }[]
    ): Promise<void>;
    countGroupsWithGlobalPermission(resource: string, actions: string[]): Promise<number>;

    assignAccountToGroup(accountId: AccountId, groupId: number): Promise<void>;
    findGroupMemberIds(groupId: number): Promise<AccountId[]>;
    removeAccountFromGroup(accountId: AccountId, groupId: number): Promise<void>;

    setDefaultGroup(groupId: number | null): Promise<void>;
    findDefaultGroupId(): Promise<number | null>;
  };
}
