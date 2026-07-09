import { createAssertions } from "./assert.js";
import { mergeWithDefaults } from "./defaults.js";
import { createGetEffectivePermissions } from "./effective-permissions.js";
import { createGroupPermissions } from "./group-permissions.js";
import { createGroups } from "./groups.js";
import type { CustomPermissionGuard, CustomPermissionGuardUserConfig } from "./types.js";

export function createCustomPermissionGuard(userConfig: CustomPermissionGuardUserConfig) {
  const config = mergeWithDefaults(userConfig);

  const { assertOne, assertAll } = createAssertions(config);
  const getEffectivePermissions = createGetEffectivePermissions(config);
  const groups = createGroups(config);
  const groupPermissions = createGroupPermissions(config);

  return {
    assertOne,
    assertAll,
    getEffectivePermissions,
    ...groups,
    ...groupPermissions,
  } satisfies CustomPermissionGuard;
}

export type {
  AccountId,
  AcrudRequirement,
  CustomPermissionGuard,
  CustomPermissionGuardConfig,
  CustomPermissionGuardUserConfig,
  CustomRequirement,
  DomainResourceSchema,
  GlobalResourceSchema,
  GroupDetail,
  GroupId,
  GroupSummary,
} from "./types.js";
export { CustomPermissionGuardConfigError } from "./errors.js";
export { defaultValueCustomPermissionGuard } from "./defaults.js";
