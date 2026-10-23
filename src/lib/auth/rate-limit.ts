/** Small in-memory limiter for login attempts (per app instance). */
const attempts = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, limit = 5, windowMs = 15 * 60 * 1000): { allowed: boolean; retryInMin: number } {
  const now = Date.now();
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
