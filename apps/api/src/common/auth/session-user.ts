import type { Role } from "@kebo/shared";

/** Who is making the request (re-checked against the database on every request). */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  sessionId: string;
}
