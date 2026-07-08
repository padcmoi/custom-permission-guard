# CHANGELOG

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
