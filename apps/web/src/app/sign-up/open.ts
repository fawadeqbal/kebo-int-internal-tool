import "server-only";
import { apiFetch } from "@/lib/api";
import { bestEffort, bodyOf } from "@/lib/quiet";

/**
 * Whether people may sign up for a trial themselves (the platform's switch). Not read (the API down, logged): closed,
 * so the pages offer "Request a demo", which works without it.
 */
export async function signUpOpen(): Promise<boolean> {
  const res = await bestEffort("whether sign-up is open (shown as closed)", apiFetch("/platform/public/sign-up", { auth: false }));
  return res?.ok ? (await bodyOf<{ open?: boolean }>(res))?.open === true : false;
}
