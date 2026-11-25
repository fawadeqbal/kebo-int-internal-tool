import "server-only";
import { textKey } from "@kebo/shared";
import { api } from "@/lib/api";
import type { DocLang } from "./zh";

/**
 * The Chinese of a paper's typed texts (its terms, sentences, heading, items without their own Chinese), from the
 * translator's memory (POST /translations/lookup): what is known now, keyed by the text as kept (textKey); the
 * rest is asked for and printed in English until the translator has written it (`waiting`). English: nothing asked.
 */
export async function chineseOf(texts: (string | null | undefined)[], lang: DocLang): Promise<{ tr: Record<string, string>; waiting: number }> {
  const list = [...new Set(texts.filter((t): t is string => !!t?.trim()).map(textKey))];
  if (lang !== "zh" || !list.length) return { tr: {}, waiting: 0 };
  try {
    const r = await api.post<{ found: Record<string, string>; waiting: number }>("/translations/lookup", { texts: list.slice(0, 300) });
    return { tr: r.found, waiting: r.waiting };
  } catch {
    // The memory cannot answer: the paper prints as before (the labels' Chinese, the items' own).
    return { tr: {}, waiting: 0 };
  }
}

/** The toolbar's word while the translator writes a paper's Chinese (screen only, never printed). */
export const waitingNote = (waiting: number) =>
  waiting > 0 ? `中文 for ${waiting} line${waiting === 1 ? " is" : "s are"} being written: print again in a minute to have ${waiting === 1 ? "it" : "them"}.` : undefined;
