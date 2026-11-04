"use server";

import { LEDGER_PARTY_KINDS, type LedgerPartyKind } from "@kebo/shared";
import { api, ApiError } from "@/lib/api";
import type { LedgerStatement } from "@/lib/types-ledger";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface IssuedStatement {
  ok: boolean;
  message?: string;
  number?: string;
  /** The print page (Statement PDF) and the PDF itself (Share). */
  view?: string;
  pdf?: string;
  share?: LedgerStatement["share"];
}

/**
 * Gives a party's statement its number (the next for the party in the year, ST-F-2026-0012) and answers where it
 * prints and downloads, with the message to share it with.
 */
export async function issueStatementAction(
  kind: LedgerPartyKind,
  id: string,
  q: { from: string; to: string; cur?: string; back?: string },
): Promise<IssuedStatement> {
  if (!LEDGER_PARTY_KINDS.includes(kind) || !UUID.test(id) || !DAY.test(q.from) || !DAY.test(q.to))
    return { ok: false, message: "That statement cannot be made." };
  try {
    const issued = await api.post<{ no: number; number: string }>(`/ledger/parties/${kind}/${id}/statement`, {
      year: Number(q.to.slice(0, 4)),
    });
    const query = { from: q.from, to: q.to, ...(q.cur ? { currency: q.cur } : {}), no: String(issued.no) };
    const s = await api.get<LedgerStatement>(`/ledger/parties/${kind}/${id}/statement`, query);
    const qs = new URLSearchParams({ from: q.from, to: q.to, ...(q.cur ? { cur: q.cur } : {}), no: String(issued.no) });
    return {
      ok: true,
      number: issued.number,
      view: `/print/ledger/${kind}/${id}?${qs}${q.back ? `&back=${encodeURIComponent(q.back)}` : ""}`,
      pdf: `/pdf/ledger-${kind}/${id}?${qs}`,
      share: s.share,
    };
  } catch (e) {
    return { ok: false, message: e instanceof ApiError ? e.message : "The statement could not be made." };
  }
}
