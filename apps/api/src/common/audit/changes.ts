/** Fields whose value changed, as { field, from, to } (both objects are flat snapshots). */
export function changesOf(oldValues: unknown, newValues: unknown) {
  const o = (oldValues && typeof oldValues === "object" ? oldValues : {}) as Record<string, unknown>;
  const n = (newValues && typeof newValues === "object" ? newValues : {}) as Record<string, unknown>;
  const show = (v: unknown) => (v === null || v === undefined || v === "" ? null : typeof v === "object" ? JSON.stringify(v) : String(v));
  return [...new Set([...Object.keys(o), ...Object.keys(n)])]
    .filter((k) => k !== "reason" && show(o[k]) !== show(n[k]))
    .map((k) => ({ field: k, from: show(o[k]), to: show(n[k]) }));
}
