import { describe, expect, it } from "vitest";
import { EnvError, loadServerEnv } from "../src";

describe("loadServerEnv", () => {
  const good = { DATABASE_URL: "postgres://u:p@localhost:5432/db", AUTH_SECRET: "x".repeat(32) };

  it("applies defaults", () => {
    const env = loadServerEnv(good);
    expect(env.API_PORT).toBe(4000);
    expect(env.APP_TIME_ZONE).toBe("Asia/Shanghai");
    expect(env.CORS_ORIGINS).toEqual([]);
  });

  it("lists every problem at once", () => {
    try {
      loadServerEnv({ AUTH_SECRET: "short", APP_TIME_ZONE: "Mars/Base" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError);
      expect((e as EnvError).issues.join(" ")).toMatch(/DATABASE_URL.*AUTH_SECRET.*APP_TIME_ZONE/s);
    }
  });

  it("splits list values", () => {
    expect(loadServerEnv({ ...good, CORS_ORIGINS: "http://a.test, http://b.test" }).CORS_ORIGINS).toEqual(["http://a.test", "http://b.test"]);
  });
});
