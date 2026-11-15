/**
 * One-time keys for saves (the API's Idempotency-Key, see apps/api common/http/once.ts). Every ActionForm sends
 * one in its `onceKey` field: the same key until the save goes through, so a double tap, or Save pressed again
 * after the answer was lost, is done once. The money actions pass it on to the API.
 */
export const ONCE_FIELD = "onceKey";
export const ONCE_HEADER = "Idempotency-Key";
export const ONCE_KEY = /^[A-Za-z0-9_-]{8,100}$/;

export function newOnceKey(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
