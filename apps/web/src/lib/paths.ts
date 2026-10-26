/**
 * A path inside this app, or the fallback. Used wherever a place to go comes from a
 * URL or form (?next=, ?back=, a notification's link), so it can never send people
 * to another site: "//evil.com", "/\evil.com" (browsers read "\" as "/"), and
 * anything with control characters are refused.
 */
export function localPath(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || [...value].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)) return fallback;
  try {
    const base = "http://app.invalid";
    const url = new URL(value, base);
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}
