# POC — proof that the library works, no HTTP required

4 apps prove `@naskot/custom-permission-guard` end to end against a real MariaDB. Each app
seeds its own fake accounts/domains/groups/permissions, runs a battery of `assertOne`/
`assertAll` calls (some expected to be **granted**, some expected to be **denied**), and exits.
No routes are ever opened — the proof is the exit code and the log, not an HTTP response.

| App                | Framework | `groupMode` | Reserved lib file/module                                      |
| ------------------ | --------- | ----------- | ------------------------------------------------------------- |
| `express-single`   | Express   | `single`    | `src/custom-permission-guard.service.ts`                      |
| `express-multiple` | Express   | `multiple`  | `src/custom-permission-guard.service.ts`                      |
| `nest-single`      | NestJS    | `single`    | `src/custom-permission-guard/` (`.service.ts` + `.module.ts`) |
| `nest-multiple`    | NestJS    | `multiple`  | `src/custom-permission-guard/` (`.service.ts` + `.module.ts`) |

One MariaDB instance, 4 schemas (`express_single_db`, `express_multiple_db`, `nest_single_db`,
`nest_multiple_db` — see [`scripts/init-mariadb.sql`](./scripts/init-mariadb.sql)), raw SQL only
via `mysql2` (no ORM). The `*_single_db` schemas add a `UNIQUE(account_id)` on `account_groups`
so `groupMode: "single"` is a real structural invariant of the schema, not something the library
enforces itself.

Each app's `poc/shared/` import pulls in the same 3 pieces every app reuses: the raw-SQL
`data.*` implementation ([`shared/sql-data.ts`](./shared/sql-data.ts)), the scenario battery
([`shared/scenarios.ts`](./shared/scenarios.ts)), and the console proof harness
([`shared/proof.ts`](./shared/proof.ts)). The lib itself is wired in locally via `file:../..`
so the POC always exercises the working tree, never a published version.

## Run

```bash
./run.sh
```

This builds the library (`npm run build` — `dist/` must exist before the POC images build),
wipes any previous run's containers/volumes for a clean slate, brings the stack up detached,
waits for each of the 4 app containers to finish (`docker wait`), and prints every container's
full log plus a pass/fail summary. Exit code `0` only if all 4 apps exited `0`.

```
express-single: OK (exit 0)
express-multiple: OK (exit 0)
nest-single: OK (exit 0)
nest-multiple: OK (exit 0)

ALL 4 POCs PROVED THE LIBRARY WORKS.
```

Containers are left **stopped, not removed** afterward, so the same proof stays inspectable:

```bash
docker compose logs express-single
docker inspect --format='{{.State.ExitCode}}' cpg-poc-nest-multiple
```

## Scenario battery

Each app runs the same ~19 scenarios (see `shared/scenarios.ts`), traced directly to
[`__PLAN/expected-custom-permission-guard/examples.md`](../__PLAN/expected-custom-permission-guard/examples.md):
the `access` prerequisite (denied at check-time even with a raw `read` row present, and stripped
at write-time when omitted), OR-across-groups in `multiple` mode vs. the schema-level
`UNIQUE(account_id)` rejection in `single` mode, domain ownership bypass, the global→domain
bridge (and that it never leaks into a sibling resource), the `dependsOn` gate on the domain tier
(denied outright, and satisfied recursively via the dependency's own bridge/ownership) and on the
global tier (denied outright, satisfied once the dependency is itself granted), `custom` checks
(granted/denied), the `authorizedPermissions` kill-switch, unknown resource/action surfacing a
distinct config error, anti-lockout, `getEffectivePermissions`, and group
CRUD/membership/default-group/`onAccountCreated`.
