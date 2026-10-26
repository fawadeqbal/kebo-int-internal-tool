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
  "orders.manage",
  /** Mark milestones done on deals the person handles. */
  "milestones.update",
  /** Go past a gate (e.g. pay the factory before the customer's deposit arrived). */
  "milestones.override",
  "factoryOrders.manage",
  "payments.record",
  "invoices.manage",
  "shipments.manage",
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
  "milestones.update",
  "factoryOrders.manage",
  "shipments.manage",
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: PERMISSIONS,
  manager: MANAGER,
  staff: STAFF,
};

export const can = (role: Role, permission: Permission): boolean => ROLE_PERMISSIONS[role].includes(permission);

export const permissionsOf = (role: Role): Permission[] => [...ROLE_PERMISSIONS[role]];
