import { COLOUR_SETS, type ColourSet } from "@kebo/shared";

/**
 * The company's colours, remembered on this device after a sign-in (written by the app frame), so the pages
 * before sign-in (sign-in, the two-step code, set a password) open in the same colours. Not secret: only one
 * of the four set names.
 */
export const COLOURS_COOKIE = "kebo-colours";

/** The set a stored value names; anything else (none yet, an old or tampered value) is Green, the default. */
export function savedColours(value: string | undefined | null): ColourSet {
  return (COLOUR_SETS as readonly string[]).includes(value ?? "") ? (value as ColourSet) : "green";
}
