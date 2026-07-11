# CHANGELOG

## [Unreleased] - yyyy-mm-dd

- Add per-group protection: `GroupSummary`/`GroupDetail` gain a `protected` flag (surfaced by
  `listGroups`/`findGroup`), `setGroupProtected(groupId, isProtected)` toggles it, and `deleteGroup`
  refuses a protected group via `onForbidden` with no exception. The lib does not decide who may
  toggle the flag (e.g. a root-only rule), that stays the consumer's policy, and a consumer with a
  raw delete path of its own must honour the flag there too. Two new `data` callbacks back it,
  `findGroupProtected` (read) and `setGroupProtected` (write). Covered by new unit tests
  (`test/unit/groups.test.ts`) and a new proof scenario (S22 in `poc/shared/scenarios.ts`), with the
  integration/POC SQL schema and the fake/SQL adapters updated for the `is_protected` column.
- Add the `utils` helper namespace (`src/index.ts`/`src/types.ts`), kept apart from the core
  `assertOne`/`assertAll`/group surface so an app that never needs it can ignore it. It carries
  `check.{global,domain}(accountId, resource, action)`, the non-throwing boolean sibling of
  `assertOne` (same ownership/bridge/`dependsOn` evaluation, `false` instead of a denial; a
  misconfiguration still throws `CustomPermissionGuardConfigError`), and
  `findUnheldPermissions(accountId, { global, domain })`, which returns the subset of the requested
  permissions the account does not hold, the primitive for anti-escalation. Both are backed by new
  non-throwing evaluators in `src/assert.ts` that leave the throwing `assertOne`/`assertAll` path
  untouched.
- Add `utils.diffPermissions(before, after)` (`src/permission-diff.ts`), a pure set difference that
  returns the `{ added, removed }` rows of a full-replace edit per tier, plus the exported types
  `PermissionSet`/`PermissionSetDiff`. Paired with `findUnheldPermissions` it lets a consumer gate
  anti-escalation on the change only, so an untouched permission the actor lacks no longer blocks an
  otherwise legitimate edit. It reports facts (added and removed separately), never policy: whether
  revoking also requires holding is the consumer's call.
- Cover the helpers with new unit tests (`test/unit/permission-diff.test.ts`, extended
  `test/unit/assert.test.ts` and `test/unit/index.test.ts`) and 3 new proof scenarios (S19/S20/S21
  in `poc/shared/scenarios.ts`, run by all 4 POC apps). Document them in the README and the
  NestJS/Express integration guides, including a worked anti-escalation `AntiEscalationService`
  example.

## [1.2.0] - 2026-07-09

- Widen `GroupId` (new exported type, `number | string`, mirroring `AccountId`) across the
  public API and `data.*` callbacks (`types.ts`, `groups.ts`, `group-permissions.ts`,
  `assert.ts`, `index.ts`): every `groupId` parameter and group-id return value now accepts a
  non-numeric ID scheme, matching the existing flexibility `AccountId` already had. Covered by
  the existing unit suite (`test/helpers/fake-data.ts` widened to match) and re-verified end to
  end against real numeric MariaDB IDs via all 4 POC apps (19/19 scenarios each).

## [1.1.0] - 2026-07-08

- Extend the `dependsOn` gate to the global tier: `GlobalResourceSchema` now accepts the same
  `dependsOn?: { resource: string; action: string }[]` as the domain tier, enforced recursively
  at check-time by `isGlobalAcrudGranted`, on the same "gate, not a bypass" contract (a failing
  dependency throws via `onForbidden` before the resource's own acrud is evaluated). No
  ownership/bridge bypass exists at this tier, so the gate always runs first. Covered by new unit
  tests (`test/unit/assert.test.ts`) and a new integration test against a real MariaDB
  (`test/integration/full-flow.test.ts`).
- Add 2 new proof scenarios (S17/S18 in `poc/shared/scenarios.ts`, run by all 4 POC apps)
  demonstrating the global-tier gate against a real MariaDB.
- Document the global-tier `dependsOn` gate in the README and the NestJS/Express integration
  guides.

## [1.0.0] - 2026-07-05

- Implement the permission engine: `assertOne`/`assertAll` (global + domain tier, acrud + custom
  dimensions, ownership/bridge bypasses, `dependsOn` gate), group CRUD, group permission grants
  with write-time access-prerequisite cleanup and anti-lockout, `getEffectivePermissions`.
- Add unit test suite (in-memory fake data) and an integration test suite against a real
  MariaDB via testcontainers.
- Add a 4-app proof of concept (2 Express, 2 NestJS; `groupMode: "single"` vs `"multiple"`)
  against a real MariaDB, run via `poc/run.sh`.
- Add Express and NestJS integration guides and the package README.
