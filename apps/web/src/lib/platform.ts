import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ApiError, platformApi, PLATFORM_COOKIE } from "./api";
import type { PlatformAdmin } from "./types-platform";

/** The set-password link of a company just made, shown once on its page. */
export const FLASH_COOKIE = "kebo_platform_flash";

/** The signed-in platform admin (once per request), or off to the platform sign-in. */
export const requirePlatformAdmin = cache(async (): Promise<PlatformAdmin> => {
  if (!(await cookies()).get(PLATFORM_COOKIE)?.value) redirect("/platform/login");
  try {
    const me = await platformApi.get<PlatformAdmin>("/auth/me");
    if (!me.twoStepOn) redirect("/platform/set-up-two-step");
    return me;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect("/platform/login");
    throw e;
  }
});

/** Load something for a platform page: 404 becomes the not-found page. */
export async function loadPlatform<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      const { notFound } = await import("next/navigation");
      notFound();
    }
    throw e;
  }
}

/** The link of the company just made, when this is its page. */
export async function readFlash(companyId: string): Promise<{ link: string | null; emailed: boolean } | null> {
  const raw = (await cookies()).get(FLASH_COOKIE)?.value;
  if (!raw) return null;
  try {
    const f = JSON.parse(raw) as { id: string; link: string | null; emailed: boolean };
    return f.id === companyId ? f : null;
  } catch {
    return null;
  }
}
