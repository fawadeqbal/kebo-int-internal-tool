import type { PaymentRoute } from "../enums";
import type { RouteTerms } from "./money-route";

/**
 * Papers in the customer's format (25 Nov 2026): the packing case by case, and the details every trade paper
 * prints under its title (who ships, who buys, the bank by the payment route, the shipping).
 *
 * Nothing here touches the database: the API and the web share it.
 */

/* ---------------------------------------------------------------- cases */

/** One row of an item's packing: `count` identical cases, each this size; the weights and volume are the row's. */
export interface CaseRow {
  caseNo: string | null;
  count: number;
  packageType: string;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  netWeightKg: number | null;
  grossWeightKg: number | null;
  /** Typed when the size is not known; worked out from the size when it is. */
  cbm: number | null;
}

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

/** The row's volume in m³: L × W × H of each case (mm) times how many, else the volume typed. 2400 × 1190 × 1960 → 5.598. */
export function caseVolume(c: Pick<CaseRow, "count" | "lengthMm" | "widthMm" | "heightMm" | "cbm">): number | null {
  if (c.lengthMm && c.widthMm && c.heightMm) return round((c.count * c.lengthMm * c.widthMm * c.heightMm) / 1e9, 3);
  return c.cbm;
}

/** "Wooden case", or "Wooden case + Carton" when an item is packed more than one way (at most 80 characters). */
function typesOf(rows: Pick<CaseRow, "packageType">[]) {
  const types = [...new Set(rows.map((r) => r.packageType.trim()).filter(Boolean))];
  return types.length ? types.join(" + ").slice(0, 80) : null;
}

/** A sum that stays empty when nothing was given (an empty weight is not 0 kg). */
function sumOf(values: (number | null)[], places: number) {
  const given = values.filter((v): v is number => v !== null);
  return given.length ? round(given.reduce((s, v) => s + v, 0), places) : null;
}

/**
 * An item's packing totals from its rows: how many packages, how they are packed, the weights and the volume.
 * The item keeps these (every screen that adds up the packing reads them); no rows: nothing packed yet.
 */
export function caseTotals(rows: CaseRow[]) {
  // Rows not counted yet (0, from packing typed before the cases) leave the packages empty, as before.
  const packages = rows.reduce((s, r) => s + r.count, 0);
  return {
    packages: packages > 0 ? packages : null,
    packageType: typesOf(rows),
    netWeightKg: sumOf(rows.map((r) => r.netWeightKg), 2),
    grossWeightKg: sumOf(rows.map((r) => r.grossWeightKg), 2),
    cbm: sumOf(rows.map(caseVolume), 3),
  };
}

/* ---------------------------------------------------------------- the details under a paper's title */

/** The buyer's tax number as their country calls it: Pakistan's National Tax Number, else "Tax No.". */
export const buyerTaxLabel = (country: string | null | undefined) => (country?.toUpperCase() === "PK" ? "N.T.N No." : "Tax No.");

/**
 * Shipper and buyer on the left; on the right the bank (none on an informal order; the contract on a bank
 * contract; the LC with its reference, the proforma's date, the day it was issued and the customer's bank on
 * an LC) and the shipping (ports, HS code, origin).
 */
export interface PaperDetails {
  shipper: { name: string; address: string | null; phone: string | null; licenceNo: string | null };
  buyer: { name: string; address: string | null; country: string | null; taxLabel: string; taxNo: string | null; regNo: string | null };
  bank:
    | { kind: "lc"; number: string | null; refNo: string | null; invoiceDate: string | null; issuedOn: string | null; name: string | null; address: string | null }
    | { kind: "contract"; number: string | null; refNo: string | null; name: string | null; address: string | null }
    | null;
  shipping: { portOfLoading: string | null; portOfDischarge: string | null; hsCode: string | null; origin: string };
}

/** Where the goods come from, as every paper says it ("Goods of Chinese origin."). */
export const GOODS_ORIGIN = "China";

export function paperDetailsOf(i: {
  company: { name: string; address?: string | null; phone?: string | null; taxNo?: string | null };
  buyer: { name: string; address?: string | null; country?: string | null; taxNo?: string | null; regNo?: string | null };
  route: PaymentRoute | null;
  /** The paper prints the bank part (not the proforma or the contract: the LC is opened against them). */
  withBank: boolean;
  contract: {
    number: string | null;
    reference: string | null;
    customerBank: string | null;
    customerBankAddress: string | null;
    /** YYYY-MM-DD */
    openedOn: string | null;
  } | null;
  /** The proforma's issue day: the invoice the LC names. */
  proformaIssuedOn: string | null;
  ports: { portOfLoading: string | null; portOfDischarge: string | null };
  /** The goods lines' HS codes. */
  hsCodes: (string | null)[];
}): PaperDetails {
  const b = i.contract;
  const hs = [...new Set(i.hsCodes.map((h) => h?.trim()).filter(Boolean))];
  return {
    shipper: { name: i.company.name, address: i.company.address || null, phone: i.company.phone || null, licenceNo: i.company.taxNo || null },
    buyer: {
      name: i.buyer.name,
      address: i.buyer.address || null,
      country: i.buyer.country || null,
      taxLabel: buyerTaxLabel(i.buyer.country),
      taxNo: i.buyer.taxNo || null,
      regNo: i.buyer.regNo || null,
    },
    bank: !i.withBank
      ? null
      : i.route === "letter_of_credit"
        ? {
            kind: "lc",
            number: b?.number ?? null,
            refNo: b?.reference ?? null,
            invoiceDate: i.proformaIssuedOn,
            issuedOn: b?.openedOn ?? null,
            name: b?.customerBank ?? null,
            address: b?.customerBankAddress ?? null,
          }
        : i.route === "bank_contract"
          ? { kind: "contract", number: b?.number ?? null, refNo: b?.reference ?? null, name: b?.customerBank ?? null, address: b?.customerBankAddress ?? null }
          : null,
    shipping: { ...i.ports, hsCode: hs.length ? hs.join(", ") : null, origin: GOODS_ORIGIN },
  };
}

/**
 * The packing list's "Payment:" line, short as the customer's own papers write it:
 *   "100% irrevocable LC at sight (LC No. LCS/4/76/823) Ref. No. AD1090926000595"
 *   "30% deposit, 70% through the banks against the shipping documents (Contract No. BC-12)"
 *   "30% deposit, balance before shipment"
 * A plan of more than a deposit and one balance: its own sentence (`sentence`), with the LC's number after it.
 */
export function paymentLineOf(i: {
  depositPercent: number;
  terms: RouteTerms;
  /** The plan is a deposit and one balance (or one payment). */
  plainPlan: boolean;
  /** "30% deposit, balance before shipment": the informal route's words. */
  termsText: string;
  /** The order's payment sentence, for a plan of more parts. */
  sentence: string;
  contract: { number: string | null; reference: string | null } | null;
}): string {
  const t = i.terms;
  const n = i.contract?.number;
  const ref = i.contract?.reference;
  const tail =
    t.route === "letter_of_credit"
      ? `${n ? ` (LC No. ${n})` : ""}${ref ? ` Ref. No. ${ref}` : ""}`
      : t.route === "bank_contract"
        ? `${n ? ` (Contract No. ${n})` : ""}${ref ? ` Ref. No. ${ref}` : ""}`
        : "";
  if (!i.plainPlan) return `${i.sentence.replace(/\.$/, "")}${tail}`;
  if (t.route !== "letter_of_credit" && t.route !== "bank_contract") return i.termsText;
  const d = i.depositPercent;
  const share = d > 0 && d < 100 ? `${d}% deposit, ${100 - d}% ` : "100% ";
  const how =
    t.route === "letter_of_credit"
      ? t.lcTerms === "deferred"
        ? `irrevocable LC payable ${t.lcDays ?? 0} days after the documents reach the buyer's bank`
        : "irrevocable LC at sight"
      : "through the banks against the shipping documents";
  return `${share}${how}${tail}`;
}
