import type { Role } from "./enums";

/**
 * Role-based access. Every check in the API and the web goes through `can`, so
 * a role can be changed or added here without touching feature code.
 * Row-level rules (staff only see their own deals) live in the API's access
 * policies, not here.
 */
export const PERMISSIONS = [
  "dashboard.view",
  "reports.view",
  "inquiries.create",
  "inquiries.viewAll",
  "inquiries.updateAny",
  "inquiries.assign",
  "inquiries.reopen",
  "inquiries.delete",
  "customers.manage",
  "customers.delete",
  "customers.export",
  "quotations.manage",
  /** Factories, their prices, our costs and margins (never shown to customers). */
  "sourcing.manage",
  /** Cancel orders. */
  "orders.manage",
  /** Move an order to its next stage (or back) and fill in its dates, on deals the person handles. */
  "orders.update",
  "payments.record",
  /** Expenses, what factories were paid and profit & loss (managers and the super admin). */
  "expenses.manage",
  "users.manage",
  "settings.manage",
  "audit.view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const MANAGER: readonly Permission[] = PERMISSIONS.filter((p) => p !== "users.manage" && p !== "settings.manage");

const STAFF: readonly Permission[] = [
  "dashboard.view",
  "inquiries.create",
  "customers.manage",
  "quotations.manage",
  "sourcing.manage",
  "orders.update",
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: PERMISSIONS,
  manager: MANAGER,
  staff: STAFF,
};

export const can = (role: Role, permission: Permission): boolean => ROLE_PERMISSIONS[role].includes(permission);

export const permissionsOf = (role: Role): Permission[] => [...ROLE_PERMISSIONS[role]];
