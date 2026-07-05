# @naskot/custom-permission-guard

Framework-agnostic ACL core: group-based access control for **global** and **per-domain**
resources, throw-on-forbidden semantics, zero coupling to any framework or database.

## What is this package?

A permission engine you configure, not a framework you adopt. It never opens an HTTP route,
never touches a database, and never reads `process.env` — the consumer wires all three. Two
independent resource tiers (`global`, `domain`), each with its own `access`-gated
read/create/modify/delete rules; group-based membership with OR/union semantics across
multiple groups; domain ownership and global→domain "bridge" bypasses; a `dependsOn` gate for
cross-resource prerequisites; and full group entity management (CRUD, membership, default
group, permission grants) with a built-in anti-lockout invariant.

## Install

```bash
npm i @naskot/custom-permission-guard
```

## Quick start

```ts
import { createCustomPermissionGuard } from "@naskot/custom-permission-guard";

const customPermissionGuard = createCustomPermissionGuard({
  onForbidden: (reason) => {
    throw new Error(reason);
  },
  groupMode: "multiple",
  schemas: {
    // "projects" is an invented, generic example resource — swap in
    // whatever your own app actually manages.
    global: { projects: { rules: ["access", "read", "create"] } },
    domain: {},
  },
  data: {
    // Every callback here is your own SQL/ORM code — see tables.sql and
    // docs/express.md or docs/nestjs.md for a full, real example.
    findAccountGroupIds: (accountId) => db.findAccountGroupIds(accountId),
    findGlobalPermissions: (groupId) => db.findGlobalPermissions(groupId),
    findDomainPermissions: (groupId) => db.findDomainPermissions(groupId),
    findOwnedDomainIds: (accountId) => db.findOwnedDomainIds(accountId),
    createGroup: (name) => db.createGroup(name),
    listGroups: () => db.listGroups(),
    findGroup: (groupId) => db.findGroup(groupId),
    updateGroup: (groupId, changes) => db.updateGroup(groupId, changes),
    setGroupOwner: (groupId, accountId) => db.setGroupOwner(groupId, accountId),
    deleteGroup: (groupId) => db.deleteGroup(groupId),
    setGroupGlobalPermissions: (groupId, permissions) => db.setGroupGlobalPermissions(groupId, permissions),
    setGroupDomainPermissions: (groupId, permissions) => db.setGroupDomainPermissions(groupId, permissions),
    countGroupsWithGlobalPermission: (resource, actions) => db.countGroupsWithGlobalPermission(resource, actions),
    assignAccountToGroup: (accountId, groupId) => db.assignAccountToGroup(accountId, groupId),
    findGroupMemberIds: (groupId) => db.findGroupMemberIds(groupId),
    removeAccountFromGroup: (accountId, groupId) => db.removeAccountFromGroup(accountId, groupId),
    setDefaultGroup: (groupId) => db.setDefaultGroup(groupId),
    findDefaultGroupId: () => db.findDefaultGroupId(),
  },
});

await customPermissionGuard.assertOne.global(accountId, "projects", { acrud: ["create"] });
```

## API

- `assertOne.{global,domain}` / `assertAll.{global,domain}.{acrud,custom}` — throw-on-forbidden
  checks; `assertOne` is single-resource sugar over the batch `assertAll` primitives.
- `getEffectivePermissions(accountId)` — read-only, never throws; real granted permissions for
  UI consumption (nav gating, etc).
- Group entity CRUD: `listGroups`, `findGroup`, `createGroup`, `updateGroup`, `deleteGroup`,
  `setGroupOwner`.
- Group permission grants: `findGroupGlobalPermissions`, `findGroupDomainPermissions`,
  `setGroupGlobalPermissions`, `setGroupDomainPermissions` (full replace, with write-time
  access-prerequisite cleanup and anti-lockout on the global tier).
- Membership: `assignAccountToGroup`, `removeAccountFromGroup`, `findGroupMemberIds`.
- Default group: `setDefaultGroup`, `onAccountCreated` (auto-assign connector).
- `CustomPermissionGuardConfigError` — thrown for a misconfigured `resource`/`action`/
  `customName` or a disabled `authorizedPermissions` dimension, always distinct from a real
  `onForbidden` denial.

See [`__PLAN/expected-custom-permission-guard/service.md`](../__PLAN/expected-custom-permission-guard/service.md)
for the full interface and design rationale.

## Integration guides

- [Express](./docs/express.md)
- [NestJS](./docs/nestjs.md)

## Proof of concept

[`poc/`](./poc) ships 4 runnable apps — 2 Express, 2 NestJS, one pair per framework configured
`groupMode: "single"` and the other `"multiple"` — that seed fake accounts/groups/permissions
against a real MariaDB and prove allow/deny behavior end to end, no HTTP routes required. See
[`poc/README.md`](./poc/README.md) to run it and read the results.

## Development

```bash
npm ci
npm run lint
npm run typecheck
npm test               # unit tests only (in-memory fake data)
npm run test:integration  # full flow against a real MariaDB via testcontainers
npm run build
```

## Notes

- Configuration rule: never read `process.env` inside the library — read env values in the
  app's own service/provider layer and pass a plain config object in.
- The library has zero runtime dependencies and never opens a database connection or an HTTP
  route itself; every `data.*` callback is SQL/ORM code the consumer owns.
- Anti-escalation (a caller can only grant permissions it already holds) and any root/superuser
  bypass are both explicitly **out of scope** — compose them from `assertOne`/`assertAll` in
  your own project, never as a library config flag.
