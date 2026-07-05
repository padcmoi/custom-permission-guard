// Thrown for misconfiguration (unknown resource/action/customName, a
// disabled authorizedPermissions dimension being requested anyway) — never
// routed through onForbidden, so a typo in schemas can never look like a
// legitimate access denial to the caller.
export class CustomPermissionGuardConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomPermissionGuardConfigError";
  }
}
