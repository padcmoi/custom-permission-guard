import type { CustomPermissionGuardConfig, CustomPermissionGuardUserConfig } from "./types.js";

export const defaultValueCustomPermissionGuard = {
  groupMode: "single",
  authorizedPermissions: {
    global: { acrud: true, custom: false },
    domain: { acrud: true, custom: false },
  },
  schemas: {
    global: {},
    domain: {},
  },
} satisfies Partial<CustomPermissionGuardConfig>;

export function mergeWithDefaults(userConfig: CustomPermissionGuardUserConfig) {
  return {
    onForbidden: userConfig.onForbidden,
    data: userConfig.data,
    groupMode: userConfig.groupMode ?? defaultValueCustomPermissionGuard.groupMode,
    authorizedPermissions: userConfig.authorizedPermissions ?? defaultValueCustomPermissionGuard.authorizedPermissions,
    schemas: userConfig.schemas ?? defaultValueCustomPermissionGuard.schemas,
    lockoutProtected: userConfig.lockoutProtected,
  } satisfies CustomPermissionGuardConfig;
}
