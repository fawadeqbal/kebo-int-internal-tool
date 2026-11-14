/**
 * Every email and phone notification sent, delivered or not, told to whoever listens (Dev tools'
 * Deliveries counts them). Nothing listens in scripts and tests that do not set it up.
 */
export interface Delivery {
  channel: "email" | "push";
  ok: boolean;
  /** The email's subject, or the notification's title. */
  what: string;
  to?: string | null;
  reason?: string | null;
}

let listener: ((d: Delivery) => void) | null = null;

export function onDelivery(fn: ((d: Delivery) => void) | null) {
  listener = fn;
}

export function delivered(d: Delivery) {
  try {
    listener?.(d);
  } catch {
    // counting must never break sending
  }
}

/** "s***@codecrood.com": enough to recognise, not enough to copy. */
export function maskAddress(to: string | string[] | null | undefined): string | null {
  const first = [to ?? []].flat()[0];
  if (!first) return null;
  const [name, domain] = first.trim().split("@");
  if (!domain) return `${first.slice(0, 1)}***`;
  return `${name!.slice(0, 1)}***@${domain}`;
}
