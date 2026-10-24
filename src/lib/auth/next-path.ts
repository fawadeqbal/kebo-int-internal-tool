/** Where to go after signing in: only same-site paths ("/x"), never "//evil.com", "/\\evil.com" or full URLs. */
export function safeNext(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/dashboard";
  try {
    const url = new URL(next, "http://app.local");
    return url.origin === "http://app.local" ? `${url.pathname}${url.search}${url.hash}` : "/dashboard";
  } catch {
    return "/dashboard";
  }
}
