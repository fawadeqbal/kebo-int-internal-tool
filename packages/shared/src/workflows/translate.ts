import { ZH_GLOSSARY } from "./zh-terms";

/**
 * The translator (25 Nov 2026): English typed in the app into Chinese for the papers in English + 中文, by a
 * translation model on our own server (docker-compose: translate). Each text once: kept with who wrote it
 * (the translator, to be checked, or a person), and a person's Chinese always wins. The same words always come
 * out the same: the glossary (ours in zh-terms, and the company's own in Settings › Chinese on papers) is given
 * with every text that has them.
 */

/** Who wrote a Chinese: the translator (printed, to be checked) or a person (typed or checked). */
export const ZH_BY = ["machine", "staff"] as const;
export type ZhBy = (typeof ZH_BY)[number];

/** A text as it is kept and looked up: its own line breaks, spaces and tabs run together, no space at the ends. */
export const textKey = (text: string) =>
  text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t\u00a0]+/g, " ").trim())
    .join("\n")
    .trim();

/** The longest text the translator takes (a long spec list is still one text). */
export const TRANSLATE_MAX = 2000;

/** Worth translating: some English words in it (not a number, a code or a name of one word alone). */
export function wantsChinese(text: string): boolean {
  const t = textKey(text);
  if (!t || t.length > TRANSLATE_MAX) return false;
  // Already Chinese, or no words: nothing to do.
  if (/[一-鿿]/.test(t)) return false;
  return (t.match(/[A-Za-z]{2,}/g) ?? []).length >= 2;
}

/** The company's glossary as typed in Settings: one "English = 中文" a line (also "English: 中文" or a tab). */
export function glossaryOf(text: string | null | undefined): { en: string; zh: string }[] {
  const out: { en: string; zh: string }[] = [];
  for (const line of (text ?? "").split(/\r?\n/)) {
    const m = /^\s*(.+?)\s*(?:=|:|：|\t)\s*(.+?)\s*$/.exec(line);
    if (m && /[A-Za-z]/.test(m[1]!) && /[一-鿿]/.test(m[2]!)) out.push({ en: m[1]!, zh: m[2]! });
  }
  return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The glossary's words this text has (the company's first, then ours; longer words first, so "blister packing
 * machine" before "machine"), at most `max`.
 */
export function termsFor(text: string, company: { en: string; zh: string }[] = [], max = 30): { en: string; zh: string }[] {
  const ours = Object.entries(ZH_GLOSSARY).map(([en, zh]) => ({ en, zh }));
  const seen = new Set<string>();
  const hits: { en: string; zh: string }[] = [];
  for (const t of [...company, ...ours].sort((a, b) => b.en.length - a.en.length)) {
    const k = t.en.toLowerCase();
    if (seen.has(k) || t.en.length < 2) continue;
    seen.add(k);
    // As the text writes it ("Blister packing machine"), so the translator sees the same words.
    const m = new RegExp(`(?:^|[^A-Za-z])(${escape(t.en)})(?:$|[^A-Za-z])`, "i").exec(text);
    if (m) hits.push({ en: m[1]!, zh: t.zh });
  }
  // The company's own first when the list is cut.
  const mine = new Set(company.map((t) => t.en.toLowerCase()));
  return hits.sort((a, b) => Number(mine.has(b.en.toLowerCase())) - Number(mine.has(a.en.toLowerCase()))).slice(0, max);
}

/** What the translation model is asked (its own Chinese template, with the glossary's words first). */
export function translatePrompt(text: string, terms: { en: string; zh: string }[] = []): string {
  const ref = terms.length ? `参考下面的翻译：\n${terms.map((t) => `${t.en} 翻译成 ${t.zh}`).join("\n")}\n\n` : "";
  return `${ref}将以下文本翻译为中文，注意只需要输出翻译后的结果，不要额外解释：\n\n${textKey(text)}`;
}

/**
 * The model's answer as kept: without quotes or a "译文：" before it, its lines as many as the English's at most;
 * null when it is no Chinese (then it is tried again later).
 */
export function cleanTranslation(answer: string | null | undefined, source: string): string | null {
  let t = textKey(answer ?? "")
    .replace(/^(译文|翻译|中文)\s*[:：]\s*/, "")
    .replace(/^["“”'‘’「」]+|["“”'‘’「」]+$/g, "")
    .trim();
  if (!t || !/[一-鿿]/.test(t)) return null;
  // As long as the English at most (an answer that goes on explaining is cut back to the lines asked for).
  const lines = textKey(source).split("\n").length;
  const got = t.split("\n").filter(Boolean);
  if (got.length > lines) t = got.slice(0, lines).join("\n");
  return t.length > TRANSLATE_MAX * 2 ? null : t;
}
