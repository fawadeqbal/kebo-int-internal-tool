import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PERMISSIONS } from "@kebo/shared";
import { api, signIn, startApp } from "./app";
import { AccessMap } from "../src/common/auth/access-map";

/**
 * Who can do what is written down: every API route states the rule that opens it (@Public, @PlatformRoute,
 * @RequirePermissions or @SignedIn with the rule in words), and Settings › Roles shows them.
 */
describe("every API call states its rule", () => {
  let app: INestApplication;
  let routes: ReturnType<AccessMap["routes"]>;

  beforeAll(async () => {
    app = await startApp();
    routes = app.get(AccessMap).routes();
  });
  afterAll(async () => {
    await app?.close();
  });

  it("finds the routes", () => {
    expect(routes.length).toBeGreaterThan(300);
    expect(routes.find((r) => r.path === "/api/orders/:id/payments" && r.method === "POST")?.rule).toEqual({ kind: "permissions", permissions: ["payments.record"] });
  });

  it("none is left without one", () => {
    expect(routes.filter((r) => r.rule.kind === "none").map((r) => `${r.method} ${r.path}`)).toEqual([]);
  });

  it("names only permissions that exist; a rule in words says something", () => {
    const known = new Set<string>(PERMISSIONS);
    const unknown = routes.flatMap((r) => (r.rule.kind === "permissions" ? r.rule.permissions.filter((p) => !known.has(p)).map((p) => `${r.method} ${r.path}: ${p}`) : []));
    expect(unknown).toEqual([]);
    const short = routes.filter((r) => r.rule.kind === "signed-in" && r.rule.rule.trim().length < 8).map((r) => `${r.method} ${r.path}`);
    expect(short).toEqual([]);
  });

  it("Settings › Roles reads them (security.manage), without the platform's own", async () => {
    const admin = await signIn(app, "admin@example.com", "Admin@12345");
    const sana = await signIn(app, "sana@example.com");
    const map = (await api(app, admin).get("/security/access-map").expect(200)).body as { method: string; path: string; rule: { kind: string } }[];
    expect(map.length).toBeGreaterThan(250);
    expect(map.some((r) => r.path.startsWith("/api/platform"))).toBe(false);
    expect(map.find((r) => r.path === "/api/notifications" && r.method === "GET")?.rule).toEqual({ kind: "signed-in", rule: "their own notifications" });
    await api(app, sana).get("/security/access-map").expect(403);
  });
});
