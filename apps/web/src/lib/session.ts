import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { can, type Permission, type PlanFeature, type Role } from "@kebo/shared";
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
  /** A platform admin working in this company. */
  viaPlatform?: boolean;
  company?: { slug: string; name: string; kind: "client" | "demo" | "trial"; status: "active" | "read_only" | "off" | "deleted"; statusReason: string | null; endsAt: string | null } | null;
}

/** The company the person is signed in to: its plan, usage, features and the notices to show. */
export interface CompanyView {
  slug: string;
  name: string;
  kind: "client" | "demo" | "trial";
  status: "active" | "read_only" | "off" | "deleted";
  statusReason: string | null;
  endsAt: string | null;
  renewsOn: string | null;
  plan: { name: string; maxUsers: number | null; maxStorageMb: number | null; features: string[]; priceMinor: number; currency: string; period: string } | null;
  features: string[];
  usage: { users: number; storageMb: number };
  notices: { tone: "info" | "warn" | "danger"; text: string }[];
}

/** The signed-in person's company (once per request). */
export const getCompany = cache(async (): Promise<CompanyView | null> => api.get<CompanyView>("/company").catch(() => null));

/** Whether the company's plan includes a feature (no answer: assume yes, the API still checks). */
export async function hasFeature(feature: PlanFeature) {
  const c = await getCompany();
  return !c || c.features.includes(feature);
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

/** The company's brand on its documents (Settings → Company: logo, title, the line under it); null when it cannot be read. */
export const docBrand = cache(async (): Promise<{ logo: string | null; mark: string; tagline: string | null } | null> => {
  const b = await api.get<{ logo: string | null; mark: string; tagline: string | null }>("/company/brand").catch(() => null);
  return b ? { logo: b.logo, mark: b.mark, tagline: b.tagline } : null;
});
