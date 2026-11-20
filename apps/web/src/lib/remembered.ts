/**
 * Welcome back (board "Trusted sign-in, refined", Laptop B): the account last signed in on this device with
 * "Keep me signed in" ticked, so the next sign-in asks only for the password. Kept in an httpOnly cookie on
 * this device only; "Not you?" and signing in without "Keep me signed in" forget it. Holds the email and the
 * person's name, nothing secret.
 */
export const REMEMBERED_COOKIE = "kebo-account";
/** About six months. */
export const REMEMBERED_MAX_AGE = 180 * 86_400;

export interface RememberedAccount {
  email: string;
  name: string | null;
}

const EMAIL = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}$/;

/** The cookie's value for an account (base64url JSON). */
export function rememberValue(account: RememberedAccount): string {
  return Buffer.from(JSON.stringify({ e: account.email, n: account.name ?? undefined }), "utf8").toString("base64url");
}

/** The account a cookie names, or null for none, an old or tampered value. */
export function rememberedAccount(value: string | undefined | null): RememberedAccount | null {
  if (!value || value.length > 600) return null;
  try {
    const raw = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { e?: unknown; n?: unknown };
    if (typeof raw.e !== "string" || !EMAIL.test(raw.e)) return null;
    const name = typeof raw.n === "string" && raw.n.trim() && raw.n.length <= 120 ? raw.n.trim() : null;
    return { email: raw.e, name };
  } catch {
    return null;
  }
}
