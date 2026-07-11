import { CustomPermissionGuardConfigError } from "./errors.js";
import type { AccountId, AcrudRequirement, CustomPermissionGuardConfig, CustomRequirement, GroupId } from "./types.js";

type Tier = "global" | "domain";
type Dimension = "acrud" | "custom";

// Scoped to a single assertAll(...) call — never persisted beyond it, so a
// permission change always takes effect on the very next call.
interface CheckCache {
  groupIds: Map<AccountId, Promise<GroupId[]>>;
  globalPerms: Map<GroupId, Promise<{ resource: string; action: string }[]>>;
  domainPerms: Map<GroupId, Promise<{ domainId: number; resource: string; action: string }[]>>;
}

function createCache() {
  return {
    groupIds: new Map<AccountId, Promise<GroupId[]>>(),
    globalPerms: new Map<GroupId, Promise<{ resource: string; action: string }[]>>(),
    domainPerms: new Map<GroupId, Promise<{ domainId: number; resource: string; action: string }[]>>(),
  };
}

function resolveGroupIds(config: CustomPermissionGuardConfig, cache: CheckCache, accountId: AccountId) {
  let cached = cache.groupIds.get(accountId);
  if (!cached) {
    cached = config.data.findAccountGroupIds(accountId);
    cache.groupIds.set(accountId, cached);
  }
  return cached;
}

function resolveGlobalPermissions(config: CustomPermissionGuardConfig, cache: CheckCache, groupId: GroupId) {
  let cached = cache.globalPerms.get(groupId);
  if (!cached) {
    cached = config.data.findGlobalPermissions(groupId);
    cache.globalPerms.set(groupId, cached);
  }
  return cached;
}

function resolveDomainPermissions(config: CustomPermissionGuardConfig, cache: CheckCache, groupId: GroupId) {
  let cached = cache.domainPerms.get(groupId);
  if (!cached) {
    cached = config.data.findDomainPermissions(groupId);
    cache.domainPerms.set(groupId, cached);
  }
  return cached;
}

function requiredActionsFor(action: string) {
  return action === "access" ? ["access"] : ["access", action];
}

function assertDimensionAuthorized(config: CustomPermissionGuardConfig, tier: Tier, dimension: Dimension) {
  if (!config.authorizedPermissions[tier][dimension]) {
    throw new CustomPermissionGuardConfigError(`${tier}.${dimension} is disabled by authorizedPermissions`);
  }
}

function knownGlobalSchema(config: CustomPermissionGuardConfig, resource: string, action: string) {
  const schema = config.schemas.global[resource];
  if (!schema) throw new CustomPermissionGuardConfigError(`unknown global resource: ${resource}`);
  if (!schema.rules.includes(action)) {
    throw new CustomPermissionGuardConfigError(`unknown global action: ${resource}.${action}`);
  }
  return schema;
}

function knownDomainSchema(config: CustomPermissionGuardConfig, resource: string, action: string) {
  const schema = config.schemas.domain[resource];
  if (!schema) throw new CustomPermissionGuardConfigError(`unknown domain resource: ${resource}`);
  if (!schema.rules.includes(action)) {
    throw new CustomPermissionGuardConfigError(`unknown domain action: ${resource}.${action}`);
  }
  return schema;
}

async function isGrantedByGroups(
  config: CustomPermissionGuardConfig,
  cache: CheckCache,
  tier: Tier,
  accountId: AccountId,
  domainId: number | undefined,
  resource: string,
  requiredActions: string[]
) {
  const groupIds = await resolveGroupIds(config, cache, accountId);
  for (const groupId of groupIds) {
    const perms =
      tier === "global"
        ? await resolveGlobalPermissions(config, cache, groupId)
        : (await resolveDomainPermissions(config, cache, groupId)).filter((p) => p.domainId === domainId);
    if (requiredActions.every((a) => perms.some((p) => p.resource === resource && p.action === a))) {
      return true; // first group that grants wins — others refusing is irrelevant
    }
  }
  return false;
}

async function isGlobalAcrudGranted(
  config: CustomPermissionGuardConfig,
  cache: CheckCache,
  accountId: AccountId,
  resource: string,
  action: string
) {
  const schema = knownGlobalSchema(config, resource, action);

  // Gate: dependsOn makes access HARDER, never easier — same contract as the
  // domain tier's gate in isDomainAcrudGranted below (a failing dependency
  // THROWS via onForbidden instead of returning false, so this resource's
  // own acrud is never even evaluated once a dependency is missing). No
  // ownership/bridge bypass exists at this tier, so there's nothing for the
  // gate to sit behind — it always runs first.
  if (schema.dependsOn) {
    for (const dep of schema.dependsOn) {
      await assertSingleGlobalAcrud(config, cache, accountId, dep.resource, dep.action);
    }
  }

  return isGrantedByGroups(config, cache, "global", accountId, undefined, resource, requiredActionsFor(action));
}

async function isDomainAcrudGranted(
  config: CustomPermissionGuardConfig,
  cache: CheckCache,
  accountId: AccountId,
  domainId: number,
  resource: string,
  action: string
) {
  const schema = knownDomainSchema(config, resource, action);

  // Bypass 1: ownership short-circuits everything (bridge, dependsOn, groups).
  const ownedDomainIds = await config.data.findOwnedDomainIds(accountId);
  if (ownedDomainIds.includes(domainId)) return true;

  // Bypass 2: bridge from a global resource, on ANY domainId.
  if (schema.bridgeFromGlobal) {
    const viaBridge = await isGlobalAcrudGranted(config, cache, accountId, schema.bridgeFromGlobal, action);
    if (viaBridge) return true;
  }

  // Gate: dependsOn makes access HARDER, never easier. Recursion means a
  // dependency benefits from its own ownership/bridge bypasses too. Unlike
  // the bridge check above, a failing dependency THROWS (via onForbidden)
  // instead of returning false — this resource's own acrud is never even
  // evaluated once a dependency is missing.
  if (schema.dependsOn) {
    for (const dep of schema.dependsOn) {
      await assertSingleDomainAcrud(config, cache, accountId, domainId, dep.resource, dep.action);
    }
  }

  return isGrantedByGroups(config, cache, "domain", accountId, domainId, resource, requiredActionsFor(action));
}

async function assertSingleGlobalAcrud(
  config: CustomPermissionGuardConfig,
  cache: CheckCache,
  accountId: AccountId,
  resource: string,
  action: string
) {
  const granted = await isGlobalAcrudGranted(config, cache, accountId, resource, action);
  if (!granted) config.onForbidden(`missing global ${resource}.${action}`);
}

// Non-throwing twins of isGlobalAcrudGranted/isDomainAcrudGranted, feeding the
// query API (check.*, findUnheldPermissions). Identical evaluation with ONE
// deliberate difference: a missing dependsOn returns false here instead of
// throwing via onForbidden. The assert path above must throw the DEPENDENCY's
// own denial reason, a "held?" query must never throw a legitimate denial at
// all -- so the two paths stay separate rather than one silently changing the
// other's error messages. A genuine misconfiguration (unknown resource/action)
// still throws CustomPermissionGuardConfigError from knownGlobalSchema, exactly
// as the assert path does: a typo is never a legitimate "not held".
async function evalGlobalAcrudHeld(
  config: CustomPermissionGuardConfig,
  cache: CheckCache,
  accountId: AccountId,
  resource: string,
  action: string
) {
  const schema = knownGlobalSchema(config, resource, action);
  if (schema.dependsOn) {
    for (const dep of schema.dependsOn) {
      if (!(await evalGlobalAcrudHeld(config, cache, accountId, dep.resource, dep.action))) return false;
    }
  }
  return isGrantedByGroups(config, cache, "global", accountId, undefined, resource, requiredActionsFor(action));
}

async function evalDomainAcrudHeld(
  config: CustomPermissionGuardConfig,
  cache: CheckCache,
  accountId: AccountId,
  domainId: number,
  resource: string,
  action: string
) {
  const schema = knownDomainSchema(config, resource, action);

  const ownedDomainIds = await config.data.findOwnedDomainIds(accountId);
  if (ownedDomainIds.includes(domainId)) return true;

  if (schema.bridgeFromGlobal) {
    if (await evalGlobalAcrudHeld(config, cache, accountId, schema.bridgeFromGlobal, action)) return true;
  }

  if (schema.dependsOn) {
    for (const dep of schema.dependsOn) {
      if (!(await evalDomainAcrudHeld(config, cache, accountId, domainId, dep.resource, dep.action))) return false;
    }
  }

  return isGrantedByGroups(config, cache, "domain", accountId, domainId, resource, requiredActionsFor(action));
}

async function assertSingleDomainAcrud(
  config: CustomPermissionGuardConfig,
  cache: CheckCache,
  accountId: AccountId,
  domainId: number,
  resource: string,
  action: string
) {
  const granted = await isDomainAcrudGranted(config, cache, accountId, domainId, resource, action);
  if (!granted) config.onForbidden(`missing domain ${resource}.${action} on domain ${String(domainId)}`);
}

function knownGlobalCustomPredicate(config: CustomPermissionGuardConfig, resource: string, customName: string) {
  const predicate = config.schemas.global[resource]?.custom?.[customName];
  if (!predicate) {
    throw new CustomPermissionGuardConfigError(`unknown global custom check: ${resource}.${customName}`);
  }
  return predicate;
}

function knownDomainCustomPredicate(config: CustomPermissionGuardConfig, resource: string, customName: string) {
  const predicate = config.schemas.domain[resource]?.custom?.[customName];
  if (!predicate) {
    throw new CustomPermissionGuardConfigError(`unknown domain custom check: ${resource}.${customName}`);
  }
  return predicate;
}

// Sync today (schemas.*.custom predicates are (accountId) => boolean, no DB
// access) — these two stay plain functions rather than async so they don't
// trip require-await; the public assertAll.*.custom methods still return a
// Promise (see createAssertions) to keep the API future-proof if predicates
// ever need to become async.
function assertSingleGlobalCustom(
  config: CustomPermissionGuardConfig,
  accountId: AccountId,
  resource: string,
  customName: string
) {
  const predicate = knownGlobalCustomPredicate(config, resource, customName);
  if (predicate(accountId) !== true) config.onForbidden(`custom check failed: ${resource}.${customName}`);
}

function assertSingleDomainCustom(
  config: CustomPermissionGuardConfig,
  accountId: AccountId,
  resource: string,
  customName: string
) {
  const predicate = knownDomainCustomPredicate(config, resource, customName);
  if (predicate(accountId) !== true) config.onForbidden(`custom check failed: ${resource}.${customName}`);
}

export interface Assertions {
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
  check: {
    global(accountId: AccountId, resource: string, action: string): Promise<boolean>;
    domain(accountId: AccountId, domainId: number, resource: string, action: string): Promise<boolean>;
  };
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
}

export function createAssertions(config: CustomPermissionGuardConfig) {
  const assertAll: Assertions["assertAll"] = {
    global: {
      async acrud(accountId, requirements) {
        assertDimensionAuthorized(config, "global", "acrud");
        const cache = createCache();
        for (const { resource, acrud } of requirements) {
          for (const action of acrud ?? []) {
            await assertSingleGlobalAcrud(config, cache, accountId, resource, action);
          }
        }
      },
      custom(accountId, requirements) {
        assertDimensionAuthorized(config, "global", "custom");
        for (const { resource, custom } of requirements) {
          for (const customName of custom ?? []) {
            assertSingleGlobalCustom(config, accountId, resource, customName);
          }
        }
        return Promise.resolve();
      },
    },
    domain: {
      async acrud(accountId, domainId, requirements) {
        assertDimensionAuthorized(config, "domain", "acrud");
        const cache = createCache();
        for (const { resource, acrud } of requirements) {
          for (const action of acrud ?? []) {
            await assertSingleDomainAcrud(config, cache, accountId, domainId, resource, action);
          }
        }
      },
      custom(accountId, _domainId, requirements) {
        // domainId is accepted only for shape parity with domain.acrud —
        // schemas.domain[resource].custom predicates are (accountId) =>
        // boolean, same as the global tier, so it's never actually read.
        assertDimensionAuthorized(config, "domain", "custom");
        for (const { resource, custom } of requirements) {
          for (const customName of custom ?? []) {
            assertSingleDomainCustom(config, accountId, resource, customName);
          }
        }
        return Promise.resolve();
      },
    },
  };

  const assertOne: Assertions["assertOne"] = {
    async global(accountId, resource, requirements) {
      if (requirements.acrud) await assertAll.global.acrud(accountId, [{ resource, acrud: requirements.acrud }]);
      if (requirements.custom) await assertAll.global.custom(accountId, [{ resource, custom: requirements.custom }]);
    },
    async domain(accountId, domainId, resource, requirements) {
      if (requirements.acrud) {
        await assertAll.domain.acrud(accountId, domainId, [{ resource, acrud: requirements.acrud }]);
      }
      if (requirements.custom) {
        await assertAll.domain.custom(accountId, domainId, [{ resource, custom: requirements.custom }]);
      }
    },
  };

  // Non-throwing acrud query: `true` when the account effectively holds
  // resource.action (honouring the same ownership/bridge/dependsOn evaluation
  // as assertOne), `false` when it does not, instead of throwing via
  // onForbidden. A misconfiguration still throws CustomPermissionGuardConfigError.
  const check: Assertions["check"] = {
    global(accountId, resource, action) {
      assertDimensionAuthorized(config, "global", "acrud");
      return evalGlobalAcrudHeld(config, createCache(), accountId, resource, action);
    },
    domain(accountId, domainId, resource, action) {
      assertDimensionAuthorized(config, "domain", "acrud");
      return evalDomainAcrudHeld(config, createCache(), accountId, domainId, resource, action);
    },
  };

  // Anti-escalation primitive: returns the subset of `required` that `accountId`
  // does NOT hold (empty arrays => holds them all). The consumer decides the
  // reaction -- throw, log, strip the offending rows -- and owns any superuser
  // bypass (check isRoot before calling). The lib stays agnostic of "who may
  // grant what"; it only answers "does this subject hold these permissions".
  // One shared cache spans the whole batch, so N permissions for the same
  // grantee resolve that grantee's groups once.
  async function findUnheldPermissions(
    accountId: AccountId,
    required: {
      global?: { resource: string; action: string }[];
      domain?: { domainId: number; resource: string; action: string }[];
    }
  ) {
    const globalReq = required.global ?? [];
    const domainReq = required.domain ?? [];
    const cache = createCache();

    const global: { resource: string; action: string }[] = [];
    if (globalReq.length) {
      assertDimensionAuthorized(config, "global", "acrud");
      for (const p of globalReq) {
        if (!(await evalGlobalAcrudHeld(config, cache, accountId, p.resource, p.action))) global.push(p);
      }
    }

    const domain: { domainId: number; resource: string; action: string }[] = [];
    if (domainReq.length) {
      assertDimensionAuthorized(config, "domain", "acrud");
      for (const p of domainReq) {
        if (!(await evalDomainAcrudHeld(config, cache, accountId, p.domainId, p.resource, p.action))) domain.push(p);
      }
    }

    return { global, domain };
  }

  return { assertOne, assertAll, check, findUnheldPermissions } satisfies Assertions;
}
