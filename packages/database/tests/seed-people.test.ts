import { describe, expect, it } from "vitest";
import { seedPeople } from "../scripts/seed-people";

describe("the starting accounts", () => {
  it("use the local defaults outside production", () => {
    const p = seedPeople({ NODE_ENV: "development" });
    expect(p.admin).toEqual({ role: "admin", email: "admin@example.com", name: "Super Admin", password: "Admin@12345" });
    expect(p.staff.password).toBe("Staff@12345");
  });

  it("take emails, names and passwords from SEED_*", () => {
    const p = seedPeople({ SEED_MANAGER_EMAIL: "boss@kebo.test", SEED_MANAGER_NAME: "Boss", SEED_MANAGER_PASSWORD: "Long-pass-1" });
    expect(p.manager).toEqual({ role: "manager", email: "boss@kebo.test", name: "Boss", password: "Long-pass-1" });
  });

  it("refuse the default passwords in production, naming what is missing", () => {
    expect(() => seedPeople({ NODE_ENV: "production", SEED_ADMIN_PASSWORD: "x-long-one" })).toThrow(
      /SEED_MANAGER_PASSWORD, SEED_STAFF_PASSWORD/,
    );
    expect(() =>
      seedPeople({ NODE_ENV: "production", SEED_ADMIN_PASSWORD: " ", SEED_MANAGER_PASSWORD: "a", SEED_STAFF_PASSWORD: "b" }),
    ).toThrow(/SEED_ADMIN_PASSWORD/);
    const p = seedPeople({ NODE_ENV: "production", SEED_ADMIN_PASSWORD: "a1", SEED_MANAGER_PASSWORD: "b2", SEED_STAFF_PASSWORD: "c3" });
    expect([p.admin.password, p.manager.password, p.staff.password]).toEqual(["a1", "b2", "c3"]);
  });
});
