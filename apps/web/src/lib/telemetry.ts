/**
 * What people's browsers saw, sent to Dev tools › Speed and errors (POST /api/telemetry): an error on a page
 * (counted once per kind there, like the server's), and how fast a page showed its main part. Fire and forget:
 * it never throws and never waits; at most 20 reports from one page load, and the same error once.
 */
export type Report =
  { kind: "error"; page: string; name?: string; message: string; stack?: string } | { kind: "speed"; page: string; ms: number };

const URL_ = "/api/telemetry";
const MAX_PER_LOAD = 20;
const seen = new Set<string>();
let sent = 0;

/** Browser noise with nothing to fix in the app: extensions, and the resize observer's harmless loop notice. */
export function isNoise(r: Report): boolean {
  if (r.kind !== "error") return false;
  const text = `${r.message}\n${r.stack ?? ""}`;
  return /chrome-extension:|moz-extension:|safari-(web-)?extension:|ResizeObserver loop/.test(text) || r.message === "Script error.";
}

export function report(r: Report) {
  try {
    if (sent >= MAX_PER_LOAD || isNoise(r)) return;
    if (r.kind === "error") {
      const key = `${r.name ?? ""}|${r.message}|${r.page}`;
      if (seen.has(key)) return;
      seen.add(key);
    }
    sent += 1;
    const body = JSON.stringify({ ...r, page: r.page.split(/[?#]/)[0] || "/" });
    const beacon = typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function";
    if (beacon && navigator.sendBeacon(URL_, new Blob([body], { type: "application/json" }))) return;
    void fetch(URL_, { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(() => undefined);
  } catch {
    // Never in the way of the page.
  }
}

/** An error (or anything thrown) as a report for this page. */
export function errorReport(e: unknown, fallbackName = "Error"): Report {
  const err = e instanceof Error ? e : null;
  return {
    kind: "error",
    page: typeof location !== "undefined" ? location.pathname : "/",
    name: (err?.name || fallbackName).slice(0, 120),
    message: (err?.message ?? String(e)).slice(0, 2000),
    stack: err?.stack?.slice(0, 8000),
  };
}
