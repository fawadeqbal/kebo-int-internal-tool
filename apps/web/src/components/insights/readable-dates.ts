/** "2026-11-04" → "04 Nov" in the reminders' words (the API writes dates as ISO). */
export const readableDates = (text: string) =>
  text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, y: string, m: string, d: string) => {
    const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", ...(dt.getUTCFullYear() !== new Date().getUTCFullYear() && { year: "numeric" }), timeZone: "UTC" });
  });
