// Pure set-difference over permission-shaped rows, config-free. It answers "what
// does this full-replace edit actually change", the missing companion to
// findUnheldPermissions: compute the delta with diffPermissions, then feed the
// changed rows to findUnheldPermissions to enforce anti-escalation on an edit.
//
// It reports facts (added/removed), never policy: whether REVOKING a permission
// you do not hold is allowed is the consumer's call, so both sides are returned
// separately and the consumer decides which to gate.
import type { PermissionSet } from "./types.js";

const globalKey = (p: { resource: string; action: string }) => `${p.resource}:${p.action}`;
const domainKey = (p: { domainId: number; resource: string; action: string }) =>
  `${String(p.domainId)}:${p.resource}:${p.action}`;

function onlyIn<T>(source: T[], other: T[], key: (item: T) => string) {
  const otherKeys = new Set(other.map(key));
  return source.filter((item) => !otherKeys.has(key(item)));
}

export function diffPermissions(before: PermissionSet, after: PermissionSet) {
  const beforeGlobal = before.global ?? [];
  const afterGlobal = after.global ?? [];
  const beforeDomain = before.domain ?? [];
  const afterDomain = after.domain ?? [];
  return {
    added: {
      global: onlyIn(afterGlobal, beforeGlobal, globalKey),
      domain: onlyIn(afterDomain, beforeDomain, domainKey),
    },
    removed: {
      global: onlyIn(beforeGlobal, afterGlobal, globalKey),
      domain: onlyIn(beforeDomain, afterDomain, domainKey),
    },
  };
}
