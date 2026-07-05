// Console proof harness shared by all 4 POC apps — no HTTP server, no
// routes. Each app seeds its own fake data, runs a battery of steps against
// the guard, then exits: 0 only if every step passed, 1 if any step failed,
// 2 if the harness itself crashed. The exit code + these logs are the proof.

export class PermissionDeniedError extends Error {}

interface StepResult {
  name: string;
  ok: boolean;
  ms: number;
  reason?: string;
}

const results: StepResult[] = [];

function color(code: number, s: string) {
  return `\x1b[${code}m${s}\x1b[0m`;
}
const green = (s: string) => color(32, s);
const red = (s: string) => color(31, s);
const yellow = (s: string) => color(33, s);
const dim = (s: string) => color(2, s);

export async function step(name: string, fn: () => Promise<void>) {
  const startedAt = Date.now();
  process.stdout.write(`${dim("▸")} ${name} ${dim("...")} `);
  try {
    await fn();
    const ms = Date.now() - startedAt;
    results.push({ name, ok: true, ms });
    console.log(green(`OK ${ms}ms`));
  } catch (err) {
    const ms = Date.now() - startedAt;
    const reason = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, ms, reason });
    console.log(red(`FAIL ${ms}ms`));
    console.log(red(`  ${reason}`));
  }
}

export function assertEq<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function assertTrue(condition: unknown, label: string) {
  if (!condition) throw new Error(label);
}

// Runs fn and requires it to reject with an instance of ErrorClass — used to
// prove a scenario is DENIED (PermissionDeniedError) vs misconfigured
// (CustomPermissionGuardConfigError), never conflating the two. Falls back
// to a constructor-name match when `instanceof` fails: the lib is wired in
// via a `file:../..` dependency, and pnpm's hoisting can end up loading two
// distinct module instances of the same package across the workspace, which
// makes `instanceof` unreliable across that boundary even though it's
// genuinely the same class — a name check is robust to that.
export async function assertRejects(
  fn: () => Promise<unknown>,
  ErrorClass: abstract new (...args: never[]) => Error,
  label: string
) {
  try {
    await fn();
  } catch (err) {
    if (err instanceof ErrorClass) return;
    if (err instanceof Error && err.constructor.name === ErrorClass.name) return;
    const gotName = err instanceof Error ? err.constructor.name : String(err);
    throw new Error(`${label}: expected to reject with ${ErrorClass.name}, got ${gotName}`);
  }
  throw new Error(`${label}: expected to reject with ${ErrorClass.name}, but it resolved`);
}

export function summarize(appName: string): never {
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  const total = results.length;
  const totalMs = results.reduce((sum, r) => sum + r.ms, 0);

  console.log("");
  console.log(yellow("─".repeat(70)));
  console.log(yellow(appName));
  if (failed === 0) {
    console.log(green(`✓ ${passed}/${total} passed in ${totalMs}ms`));
  } else {
    console.log(red(`✗ ${failed} failed, ${passed}/${total} passed in ${totalMs}ms`));
    for (const r of results.filter((x) => !x.ok)) {
      console.log(red(`  • ${r.name}: ${r.reason}`));
    }
  }
  console.log("");
  process.exit(failed === 0 ? 0 : 1);
}
