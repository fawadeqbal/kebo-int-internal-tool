import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The theme's own text sizes (theme.css: text-2xs, text-md, text-lead beside Tailwind's names), so a size and a
 * colour in the same list never cancel each other: without this, "text-lead" read as a colour and removed
 * "text-white" from a button.
 */
const twMerge = extendTailwindMerge({
  extend: { theme: { text: ["2xs", "md", "lead"] } },
});

/** Joins class names; later Tailwind classes win over earlier conflicting ones. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
