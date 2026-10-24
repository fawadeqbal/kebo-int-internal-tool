/**
 * Cloudflare Turnstile ("not a robot" check) for the public website form.
 * On when TURNSTILE_SECRET_KEY is set; the website must then send the token
 * (see docs/keboint-contact-form.js). Free, and invisible for most visitors.
 */
export type TurnstileResult = { ok: true; checked: boolean } | { ok: false; reason: string };

export async function verifyTurnstile(token: unknown, ip: string): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true, checked: false };
  if (typeof token !== "string" || !token || token.length > 2048) return { ok: false, reason: "missing" };
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip && ip !== "local") body.set("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body, signal: AbortSignal.timeout(5000) });
    const data = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
    return data.success ? { ok: true, checked: true } : { ok: false, reason: (data["error-codes"] ?? ["failed"]).join(",") };
  } catch (error) {
    // Cloudflare unreachable: let the inquiry through (rate limits still apply) rather than lose a real customer.
    console.warn("[turnstile] could not reach Cloudflare, accepting without the check:", (error as Error).message);
    return { ok: true, checked: false };
  }
}
