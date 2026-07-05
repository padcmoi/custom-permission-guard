import type { AccountId, CustomPermissionGuardConfig } from "./types.js";

export function createGetEffectivePermissions(config: CustomPermissionGuardConfig) {
  return async function getEffectivePermissions(accountId: AccountId) {
    const groupIds = await config.data.findAccountGroupIds(accountId);

    const globalSeen = new Set<string>();
    const global: { resource: string; action: string }[] = [];
    const domainMap = new Map<string, { domainId: number; resource: string; action: string }>();

    for (const groupId of groupIds) {
      for (const { resource, action } of await config.data.findGlobalPermissions(groupId)) {
        const key = `${resource}:${action}`;
        if (!globalSeen.has(key)) {
          globalSeen.add(key);
          global.push({ resource, action });
        }
      }

      for (const { domainId, resource, action } of await config.data.findDomainPermissions(groupId)) {
        domainMap.set(`${domainId}:${resource}:${action}`, { domainId, resource, action });
      }
    }

    // Ownership synthesis: an owned domain grants every action of every
    // domain-tier resource, access included — derived dynamically from
    // schemas.domain rather than a fixed resource/action list. Deliberately
    // NOT done for bridgeFromGlobal: a bridge grants on ANY domainId, which
    // has no finite row representation here (same asymmetry as the real
    // system this was modeled on — an assertOne/assertAll-only bypass).
    const ownedDomainIds = await config.data.findOwnedDomainIds(accountId);
    for (const domainId of ownedDomainIds) {
      for (const [resource, schema] of Object.entries(config.schemas.domain)) {
        for (const action of schema.rules) {
          domainMap.set(`${domainId}:${resource}:${action}`, { domainId, resource, action });
        }
      }
    }

    return { global, domain: [...domainMap.values()] };
  };
}
