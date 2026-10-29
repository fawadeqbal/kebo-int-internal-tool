import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { companyDatabaseUrl, companyRolePassword, connectionOptions, sqlLiteral } from "../src";

/** Company connections log in as kebo_app, with a password every process can work out from AUTH_SECRET. */
describe("the company role's login", () => {
  const secret = "test-secret-test-secret-test-secret-1234";

  it("derives the password from AUTH_SECRET (HMAC-SHA256, hex), the same every time", () => {
    const expected = createHmac("sha256", secret).update("kebo_app-db-password").digest("hex");
    expect(companyRolePassword(secret)).toBe(expected);
    expect(companyRolePassword(secret)).toMatch(/^[0-9a-f]{64}$/);
    expect(companyRolePassword(`${secret}x`)).not.toBe(expected);
    expect(() => companyRolePassword("")).toThrow(/AUTH_SECRET/);
  });

  it("builds the company URL from DATABASE_URL, keeping host, port, database and options", () => {
    const url = new URL(companyDatabaseUrl("postgres://kebo:p%40ss@db:5432/kebo?sslmode=disable", secret));
    expect(url.username).toBe("kebo_app");
    expect(url.password).toBe(companyRolePassword(secret));
    expect(`${url.host}${url.pathname}${url.search}`).toBe("db:5432/kebo?sslmode=disable");
  });

  it("uses COMPANY_DATABASE_URL as it is when set", () => {
    expect(companyDatabaseUrl("postgres://kebo:x@db/kebo", secret, " postgres://other:y@h/d ")).toBe("postgres://other:y@h/d");
    expect(companyDatabaseUrl("postgres://kebo:x@db/kebo", secret, "")).toContain("kebo_app:");
  });

  it("quotes SQL strings safely", () => {
    expect(sqlLiteral("it's")).toBe("'it''s'");
  });

  it("names the company only as a company id", () => {
    expect(connectionOptions("6b65626f-0000-4000-8000-000000000001")).toContain("-c app.company_id=6b65626f-0000-4000-8000-000000000001");
    expect(() => connectionOptions("x -c role=kebo")).toThrow(/Not a company id/);
  });
});
