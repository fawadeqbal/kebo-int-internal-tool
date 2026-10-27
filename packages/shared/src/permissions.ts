import type { PresetRoleKey } from "./enums";

/**
 * Access is by permission. Roles are rows in the database (made and edited
 * under Security), each a set of these permissions; the Super Admin role always
 * has every one, including any added later. Every check in the API and the web
 * goes through `can`, with the permissions the API sends for the signed-in person.
 * Row-level rules (people without "inquiries.viewAll" only see their own deals)
 * live in the API's access policies, not here.
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
  /** Roles, two-step rules, everyone's sessions and sign-in history. */
  "security.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const isPermission = (p: string): p is Permission => (PERMISSIONS as readonly string[]).includes(p);

/** How the role editor shows the permissions: grouped, each with a name and what it allows. */
export const PERMISSION_GROUPS: { title: string; items: { permission: Permission; label: string; hint?: string }[] }[] = [
  {
    title: "Deals",
    items: [
      { permission: "inquiries.create", label: "Start deals", hint: "Add a customer's request as a new deal." },
      {
        permission: "inquiries.viewAll",
        label: "See every deal",
        hint: "Without it, they see only the deals they handle or started, and those deals' customers and orders. They also get the managers' reminders.",
      },
      { permission: "inquiries.updateAny", label: "Change anyone's deals", hint: "Work on deals handled by others, and remove factories." },
      {
        permission: "inquiries.assign",
        label: "Hand deals to others",
        hint: "Without it, they can only take unassigned deals themselves.",
      },
      { permission: "inquiries.reopen", label: "Reopen lost deals" },
      { permission: "inquiries.delete", label: "Delete deals" },
    ],
  },
  {
    title: "Customers",
    items: [
      { permission: "customers.manage", label: "Add and edit customers" },
      { permission: "customers.delete", label: "Delete customers" },
      { permission: "customers.export", label: "Export customers" },
    ],
  },
  {
    title: "Factories and quotations",
    items: [
      {
        permission: "sourcing.manage",
        label: "Factories, factory prices, costs and margins",
        hint: "Factory offers, what we pay, profit per line. Needed to quote a factory's offer.",
      },
      { permission: "quotations.manage", label: "Make and send quotations" },
    ],
  },
  {
    title: "Orders and money",
    items: [
      {
        permission: "orders.update",
        label: "Move orders along",
        hint: "Next stage, dates, goods received, packing and the proforma, on deals they work on.",
      },
      { permission: "orders.manage", label: "Cancel orders, remove payments, ship with money due" },
      { permission: "payments.record", label: "Record customer payments" },
      { permission: "expenses.manage", label: "Expenses, factory payments and profit & loss" },
    ],
  },
  {
    title: "Overview",
    items: [
      { permission: "dashboard.view", label: "Dashboard" },
      { permission: "reports.view", label: "Reports" },
      { permission: "audit.view", label: "Audit log" },
    ],
  },
  {
    title: "Administration",
    items: [
      { permission: "users.manage", label: "People", hint: "Add people, give them a role, set passwords, switch them off." },
      { permission: "settings.manage", label: "Company settings" },
      { permission: "security.manage", label: "Security", hint: "Roles, two-step rules, everyone's sessions and sign-in history." },
    ],
  },
];

const MANAGER: readonly Permission[] = PERMISSIONS.filter(
  (p) => p !== "users.manage" && p !== "settings.manage" && p !== "security.manage",
);

const STAFF: readonly Permission[] = [
  "dashboard.view",
  "inquiries.create",
  "customers.manage",
  "quotations.manage",
  "sourcing.manage",
  "orders.update",
];

/** The roles every installation starts with. Manager and Staff can be changed in Security; the Super Admin cannot. */
export const PRESET_ROLES: Record<
  PresetRoleKey,
  { name: string; description: string; permissions: readonly Permission[]; superAdmin: boolean }
> = {
  admin: {
    name: "Super Admin",
    description: "Everything, always, including permissions added later.",
    permissions: PERMISSIONS,
    superAdmin: true,
  },
  manager: {
    name: "Manager",
    description: "Sees and changes everything, assigns work, sees money and reports.",
    permissions: MANAGER,
    superAdmin: false,
  },
  staff: {
    name: "Staff",
    description: "Works the deals and orders they handle; sees only their own customers.",
    permissions: STAFF,
    superAdmin: false,
  },
};

/** What a role allows: every permission for the Super Admin; otherwise its known permissions, in the usual order. */
export const permissionsOfRole = (role: { superAdmin: boolean; permissions: readonly string[] }): Permission[] =>
  role.superAdmin ? [...PERMISSIONS] : PERMISSIONS.filter((p) => role.permissions.includes(p));

/** Whether the signed-in person (as the API describes them) may do something. */
export const can = (who: { permissions: readonly string[] } | null | undefined, permission: Permission): boolean =>
  !!who?.permissions.includes(permission);
