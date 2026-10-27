import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { can, type Permission, type Role } from "@kebo/shared";
import { api, ApiError } from "./api";

export interface Me {
  id: string;
  name: string;
  email: string;
  /** The role's key, and its name as it is now. */
  role: Role;
  roleName: string;
  permissions: Permission[];
  /** Their role needs two-step sign-in and they have not set it up: only the setup page is open. */
  twoStepSetupRequired: boolean;
}

export const TWO_STEP_SETUP_PATH = "/login/set-up-two-step";

/** The signed-in person (once per request), or off to the sign-in page. */
export const requireUser = cache(async (): Promise<Me> => {
  try {
    const me = await api.get<Me>("/auth/me");
    if (me.twoStepSetupRequired) redirect(TWO_STEP_SETUP_PATH);
    return me;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect("/login");
    throw e;
  }
});

export async function requirePermission(permission: Permission) {
  const me = await requireUser();
  if (!can(me, permission)) redirect("/forbidden");
  return me;
}

/** Load something, turning a 404 into Next's not-found page and 403 into the forbidden page. */
export async function load<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      const { notFound } = await import("next/navigation");
      notFound();
    }
    if (e instanceof ApiError && e.status === 403) redirect("/forbidden");
    if (e instanceof ApiError && e.status === 401) redirect("/login");
    throw e;
  }
}
