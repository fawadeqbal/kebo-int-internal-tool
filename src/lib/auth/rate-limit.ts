/**
 * Small in-memory limiter (one app instance). Used for the per-IP limits on
 * the login and the public inquiry form; the per-account lock that survives
 * restarts lives in the database (users.failed_logins / locked_until).
 */
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_KEYS = 20_000;

function prune(now: number) {
  for (const [k, v] of attempts) if (v.resetAt < now) attempts.delete(k);
  // Still too many (a flood of distinct keys): drop the oldest half.
  if (attempts.size > MAX_KEYS) [...attempts.keys()].slice(0, attempts.size / 2).forEach((k) => attempts.delete(k));
}

export function checkRateLimit(key: string, limit = 5, windowMs = 15 * 60 * 1000): { allowed: boolean; retryInMin: number } {
  const now = Date.now();
  if (attempts.size > MAX_KEYS) prune(now);
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryInMin: 0 };
  }
  entry.count += 1;
  if (entry.count > limit) return { allowed: false, retryInMin: Math.ceil((entry.resetAt - now) / 60000) };
  return { allowed: true, retryInMin: 0 };
}

export function resetRateLimit(key: string) {
  attempts.delete(key);
}

/**
 * The visitor's IP. Caddy sets X-Forwarded-For to the real client address;
 * the last entry is the one our own proxy added, so a client cannot fake it.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  return forwarded?.split(",").at(-1)?.trim() || headers.get("x-real-ip") || "local";
}
