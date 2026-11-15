import { config } from "zod";
import { errorReport, report } from "@/lib/telemetry";

// Before any schema runs (the shared package parses some as it loads): no eval in the browser. zod's fast path
// tries new Function, which the Content-Security-Policy forbids, so every page load would report it.
config({ jitless: true });

// Runs before the app starts in the browser: errors the page did not catch go to Dev tools › Speed and errors.
try {
  window.addEventListener("error", (e) => {
    if (e.error) return report(errorReport(e.error));
    if (e.message)
      report({ kind: "error", page: location.pathname, name: "Error", message: e.message, stack: `${e.filename}:${e.lineno}:${e.colno}` });
  });
  window.addEventListener("unhandledrejection", (e) => report(errorReport(e.reason, "Unhandled promise")));
} catch {
  // Never in the way of the page.
}
