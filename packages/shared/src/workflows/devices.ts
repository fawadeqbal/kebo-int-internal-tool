/**
 * "Chrome on Windows", "Kebo app on Android": a short name for the browser or
 * phone behind a session or a sign-in, from its user agent. Good enough to
 * recognise one's own devices; not a security check.
 */
export function deviceOf(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  if (!ua) return "Unknown device";
  const os = /Android/i.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/i.test(ua)
      ? "iPhone"
      : /Windows/i.test(ua)
        ? "Windows"
        : /Mac OS X|Macintosh/i.test(ua)
          ? "Mac"
          : /CrOS/i.test(ua)
            ? "Chromebook"
            : /Linux/i.test(ua)
              ? "Linux"
              : null;
  const app = /Dart\/|okhttp|kebo/i.test(ua)
    ? "Kebo app"
    : /Edg\//.test(ua)
      ? "Edge"
      : /OPR\/|Opera/.test(ua)
        ? "Opera"
        : /Firefox\/|FxiOS/.test(ua)
          ? "Firefox"
          : /Chrome\/|CriOS/.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : /curl|python|node|axios|undici|Postman/i.test(ua)
                ? "Script"
                : "Browser";
  return os ? `${app} on ${os}` : app;
}
