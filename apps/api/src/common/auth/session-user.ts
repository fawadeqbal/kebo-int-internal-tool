import type { Permission, Role } from "@kebo/shared";

/** Who is making the request (re-checked against the database on every request). */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  /** The role's key; its name and permissions as they are now. */
  role: Role;
  roleName: string;
  permissions: Permission[];
  /** The role needs two-step sign-in and they have not set it up yet: only the setup is open. */
  twoStepSetupRequired: boolean;
  sessionId: string;
  /** The company they are signed in to. */
  companyId: string;
  /** A platform admin working in this company (through its hidden account). */
  viaPlatform: boolean;
}
