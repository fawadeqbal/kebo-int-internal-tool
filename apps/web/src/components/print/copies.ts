import type { PaperDetails } from "@kebo/shared";
import type { DocLang } from "./zh";

/**
 * The switches over a paper (25 Nov 2026), the same on the print page's toolbar and in the app's viewer: which
 * copy, and the language. One list of choices, each a link to the same paper chosen so, the page's own query kept.
 *
 * Copies:
 * - customer: what the customer gets (the one a paper opens on);
 * - internal: priced papers with every price, cost and payment, for our own use;
 * - customs: the papers China customs takes (the contract, the commercial invoice, the packing list) as the
 *   customs broker and the shipping people read them: always in English + 中文, with China's HS codes.
 */
export type PaperCopy = "customer" | "internal" | "customs";

export const COPY_WORD: Record<PaperCopy, string> = { customer: "Customer copy", internal: "Internal copy", customs: "China customs" };

/** The words on the language switch. */
export const LANG_WORD: Record<DocLang, string> = { en: "English", zh: "English + 中文" };

const COPIES: Record<string, readonly PaperCopy[]> = {
  revisions: ["customer", "internal"],
  proforma: ["customer", "internal"],
  "packing-list": ["customer", "customs"],
  "sales-contract": ["customer", "customs"],
  "commercial-invoice": ["customer", "customs"],
};

/** The copies a paper has (by its print or PDF kind); none: it has only the one. */
export const copiesOf = (kind: string): readonly PaperCopy[] => (Object.hasOwn(COPIES, kind) ? COPIES[kind]! : []);

/** The copy asked for (?copy=), when the paper has it; else the customer's. */
export function copyOf(kind: string, asked: string | string[] | null | undefined): PaperCopy {
  return typeof asked === "string" && (copiesOf(kind) as readonly string[]).includes(asked) ? (asked as PaperCopy) : "customer";
}

/** The language a copy prints in: the China customs copy always in English + 中文. */
export const langFor = (copy: PaperCopy, lang: DocLang): DocLang => (copy === "customs" ? "zh" : lang);

/** The details under the title as a copy prints them: China's HS codes on the China customs copy. */
export function detailsFor(d: PaperDetails | null, copy: PaperCopy): PaperDetails | null {
  if (!d || copy !== "customs" || !d.shipping.hsCodeCn) return d;
  return { ...d, shipping: { ...d.shipping, hsCode: d.shipping.hsCodeCn } };
}

/** One switch over a paper: its name and its choices, each a link to the paper chosen so. */
export interface PaperChoice {
  label: string;
  options: { key: string; word: string; href: string; on: boolean; tone?: "internal" }[];
}

type Query = Record<string, string | string[] | undefined>;

/** The same paper with some of its query changed (null: left out), the rest kept (the version, where Back goes). */
export function hrefWith(path: string, sp: Query, change: Record<string, string | null>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v && !Object.hasOwn(change, k)) q.set(k, v);
  for (const [k, v] of Object.entries(change)) if (v) q.set(k, v);
  return `${path}${q.size ? `?${q}` : ""}`;
}

/**
 * The switches over a paper: which copy (when it has more than one), then the language (not on the China
 * customs copy: it is always in both).
 */
export function paperChoices(path: string, sp: Query, kind: string, copy: PaperCopy, lang: DocLang): PaperChoice[] {
  const copies = copiesOf(kind);
  return [
    ...(copies.length > 1
      ? [
          {
            label: "Which copy",
            options: copies.map((k) => ({
              key: k,
              word: COPY_WORD[k],
              href: hrefWith(path, sp, { copy: k === "customer" ? null : k }),
              on: k === copy,
              ...(k === "internal" ? { tone: "internal" as const } : {}),
            })),
          },
        ]
      : []),
    ...(copy === "customs"
      ? []
      : [
          {
            label: "Language",
            options: (["en", "zh"] as const).map((k) => ({ key: k, word: LANG_WORD[k], href: hrefWith(path, sp, { lang: k === "zh" ? k : null }), on: k === lang })),
          },
        ]),
  ];
}

/** The paper's PDF as it is shown: its copy (when not the customer's) and its language. */
export function pdfOf(href: string, copy: PaperCopy, lang: DocLang) {
  const [path, query = ""] = href.split("?");
  const q = new URLSearchParams(query);
  if (copy !== "customer") q.set("copy", copy);
  if (lang === "zh" && copy !== "customs") q.set("lang", "zh");
  return `${path}${q.size ? `?${q}` : ""}`;
}
