/** The starting accounts' emails, names and passwords, from SEED_* (with local defaults). */
export type SeedRole = "admin" | "manager" | "staff";

const DEFAULTS: Record<SeedRole, { email: string; name: string; password: string }> = {
  admin: { email: "admin@example.com", name: "Super Admin", password: "Admin@12345" },
  manager: { email: "manager@example.com", name: "Manager", password: "Manager@12345" },
  staff: { email: "staff@example.com", name: "Staff", password: "Staff@12345" },
};

export interface SeedPerson {
  role: SeedRole;
  email: string;
  name: string;
  password: string;
}

/**
 * Who to seed. In production every password must be given (SEED_ADMIN_PASSWORD,
 * SEED_MANAGER_PASSWORD, SEED_STAFF_PASSWORD): the defaults are published, so
 * they are refused there.
 */
export function seedPeople(env: Record<string, string | undefined>): Record<SeedRole, SeedPerson> {
  const roles = Object.keys(DEFAULTS) as SeedRole[];
  const key = (r: SeedRole, what: string) => `SEED_${r.toUpperCase()}_${what}`;
  if (env.NODE_ENV === "production") {
    const missing = roles.map((r) => key(r, "PASSWORD")).filter((k) => !env[k]?.trim());
    if (missing.length)
      throw new Error(
        `In production every starting account needs its own password: set ${missing.join(", ")} (the default passwords are published).`,
      );
  }
  const person = (role: SeedRole): SeedPerson => ({
    role,
    email: env[key(role, "EMAIL")] || DEFAULTS[role].email,
    name: env[key(role, "NAME")] || DEFAULTS[role].name,
    password: env[key(role, "PASSWORD")] || DEFAULTS[role].password,
  });
  return { admin: person("admin"), manager: person("manager"), staff: person("staff") };
}
