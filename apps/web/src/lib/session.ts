import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { can, type Permission, type Role } from "@kebo/shared";
import { api, ApiError } from "./api";

export interface Me {
  id: string;
  name: string;
  email: string;
  role: Role;
  permissions: Permission[];
}

/** The signed-in person (once per request), or off to the sign-in page. */
export const requireUser = cache(async (): Promise<Me> => {
  try {
    return await api.get<Me>("/auth/me");
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect("/login");
    throw e;
  }
});

export async function requirePermission(permission: Permission) {
  const me = await requireUser();
  if (!can(me.role, permission)) redirect("/forbidden");
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
