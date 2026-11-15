import { beforeEach, describe, expect, it, vi } from "vitest";

// What the browser sends to Dev tools (lib/telemetry.ts): once per error, no browser noise, at most 20 a load.
describe("browser reports", () => {
  let sent: { url: string; body: Record<string, unknown> }[];
  beforeEach(() => {
    vi.resetModules();
    sent = [];
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: (url: string, data: Blob) => {
        void data.text().then((t) => sent.push({ url, body: JSON.parse(t) }));
        return true;
      },
    });
  });
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("sends an error once, without the page's query, as JSON to /api/telemetry", async () => {
    const { report, errorReport } = await import("@/lib/telemetry");
    const e = new TypeError("x is undefined");
    report({ ...errorReport(e), page: "/orders/1/payment?tab=2" });
    report({ ...errorReport(e), page: "/orders/1/payment?tab=2" });
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      url: "/api/telemetry",
      body: { kind: "error", page: "/orders/1/payment", name: "TypeError", message: "x is undefined" },
    });
  });

  it("leaves out what the app cannot fix: extensions, the resize observer's notice", async () => {
    const { report } = await import("@/lib/telemetry");
    report({ kind: "error", page: "/", message: "boom", stack: "at chrome-extension://abc/content.js:1:1" });
    report({ kind: "error", page: "/", message: "ResizeObserver loop completed with undelivered notifications." });
    report({ kind: "error", page: "/", message: "Script error." });
    await flush();
    expect(sent).toHaveLength(0);
  });

  it("at most 20 reports from one page load", async () => {
    const { report } = await import("@/lib/telemetry");
    for (let k = 0; k < 30; k++) report({ kind: "speed", page: `/p${k}`, ms: 100 });
    await flush();
    expect(sent).toHaveLength(20);
  });
});
