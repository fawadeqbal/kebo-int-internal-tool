import { HttpException, HttpStatus, Logger } from "@nestjs/common";

/**
 * A small in-memory limiter (one API instance): at most `max` hits per key in
 * a window. When it holds too many keys it first drops the ones whose window
 * is over; only if that is not enough does it start again (so a flood of new
 * addresses cannot wipe out the limits of the ones already counted, unless
 * every one of them is still live).
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly maxKeys = 20_000,
    private readonly now: () => number = Date.now,
  ) {}

  get size() {
    return this.hits.size;
  }

  /** Counts a hit; false when the key is over its limit. */
  allow(key: string, max: number, windowMs: number): boolean {
    const now = this.now();
    if (this.hits.size >= this.maxKeys) this.evict(now);
    const h = this.hits.get(key);
    if (!h || h.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    return ++h.count <= max;
  }

  /** Counts a hit; throws 429 with this message when over the limit. */
  check(key: string, max: number, windowMs: number, message: string) {
    if (!this.allow(key, max, windowMs)) throw new HttpException({ message }, HttpStatus.TOO_MANY_REQUESTS);
  }

  clear() {
    this.hits.clear();
  }

  private evict(now: number) {
    for (const [k, h] of this.hits) if (h.resetAt <= now) this.hits.delete(k);
    if (this.hits.size >= this.maxKeys) this.hits.clear();
  }
}

const log = new Logger("Turnstile");

/**
 * Cloudflare Turnstile ("not a robot"), when TURNSTILE_SECRET_KEY is set: true
 * when the token is good, false when it is not. When Cloudflare cannot be
 * reached the answer is no (503 with a plain message): with the check switched
 * on, a form is never let through unchecked.
 */
export async function verifyTurnstile(token: unknown, ip: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (typeof token !== "string" || !token || token.length > 4000) return false;
  let body: { success?: boolean };
  try {
    const form = new URLSearchParams({ secret, response: token });
    if (ip) form.set("remoteip", ip);
    const res = await fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = (await res.json()) as { success?: boolean };
  } catch (e) {
    log.warn(`Turnstile unreachable, refusing: ${(e as Error).message}`);
    throw new HttpException(
      {
        message:
          "We could not check that you are not a robot just now. Please try again in a few minutes, or contact us by email or WhatsApp.",
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
  return !!body.success;
}
