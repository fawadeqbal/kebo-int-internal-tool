import type { Role } from "@/lib/db/schema";

/**
 * Role-based access control. Every permission check in the app goes through
 * this map, so roles can be changed or added in one place.
 */
export const PERMISSIONS = [
  "dashboard.view",
  "reports.view",
  "queries.create",
  "queries.viewAll",
  "queries.updateAny",
  "queries.assign",
  "queries.delete",
  "customers.manage",
  "customers.delete",
  "customers.export",
  "quotations.manage",
  "invoices.manage",
  "payments.record",
  "users.manage",
  "settings.manage",
  "audit.view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: PERMISSIONS,
  manager: [
    "dashboard.view",
    "reports.view",
    "queries.create",
    "queries.viewAll",
    "queries.updateAny",
    "queries.assign",
    "queries.delete",
    "customers.manage",
    "customers.delete",
    "customers.export",
    "quotations.manage",
    "invoices.manage",
    "payments.record",
    "audit.view",
  ],
  staff: ["dashboard.view", "queries.create", "customers.manage", "quotations.manage"],
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Super Admin",
  manager: "Manager",
  staff: "Staff",
};

/**
 * Roles that must use two-step sign-in (authenticator app). Default: Super
 * Admin and Manager. TWO_STEP_REQUIRED_ROLES="admin,manager,staff" adds Staff;
 * an empty value makes it optional for everyone (local testing only).
 */
export function twoStepRequired(role: Role): boolean {
  const configured = process.env.TWO_STEP_REQUIRED_ROLES;
  const roles = configured === undefined ? ["admin", "manager"] : configured.split(",").map((r) => r.trim());
  return roles.includes(role);
}
