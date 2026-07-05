# CHANGELOG

## [Unreleased] - 2026-07-05

- Implement the permission engine: `assertOne`/`assertAll` (global + domain tier, acrud + custom
  dimensions, ownership/bridge bypasses, `dependsOn` gate), group CRUD, group permission grants
  with write-time access-prerequisite cleanup and anti-lockout, `getEffectivePermissions`.
- Add unit test suite (in-memory fake data) and an integration test suite against a real
  MariaDB via testcontainers.
- Add a 4-app proof of concept (2 Express, 2 NestJS; `groupMode: "single"` vs `"multiple"`)
  against a real MariaDB, run via `poc/run.sh`.
- Add Express and NestJS integration guides and the package README.
