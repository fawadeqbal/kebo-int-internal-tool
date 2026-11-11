import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LEDGER_PARTY_KINDS, type LedgerPartyKind, type PaperDoc } from "@kebo/shared";
import { api } from "@/lib/api";
import { docBrand, load } from "@/lib/session";
import type { LedgerStatement } from "@/lib/types-ledger";
import { PaperSheet } from "@/components/print/paper";
import { PrintToolbar } from "@/components/print/toolbar";
import { backTo } from "@/components/print/data";
import { PARTY_PATH } from "@/components/ledger/ledger-parts";
import { UUID } from "@/lib/ids";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

type Query = { from?: string; to?: string; cur?: string; no?: string; back?: string };

/** The statement's query, only what is well formed. */
function queryOf(sp: Query) {
  return {
    ...(sp.from && DAY.test(sp.from) ? { from: sp.from } : {}),
    ...(sp.to && DAY.test(sp.to) ? { to: sp.to } : {}),
    ...(sp.cur && /^[A-Z]{3}$/.test(sp.cur) ? { cur: sp.cur } : {}),
    ...(sp.no && /^\d{1,5}$/.test(sp.no) ? { no: sp.no } : {}),
  } as Record<string, string>;
}

async function getStatement(kind: string, id: string, sp: Query) {
  if (!LEDGER_PARTY_KINDS.includes(kind as LedgerPartyKind) || !UUID.test(id)) notFound();
  const q = queryOf(sp);
  return load(() =>
    api.get<LedgerStatement>(`/ledger/parties/${kind}/${id}/statement`, { from: q.from, to: q.to, currency: q.cur, no: q.no }),
  );
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string; id: string }>;
  searchParams: Promise<Query>;
}): Promise<Metadata> {
  const [{ kind, id }, sp] = await Promise.all([params, searchParams]);
  const s = await getStatement(kind, id, sp);
  return { title: `Statement ${s.doc.number} · ${s.party.name}` };
}

/**
 * A customer's, factory's or person's statement of account, in Kebo's one document template (KeboDoc): made from
 * their ledger for the period, in one currency, numbered per party and year when issued.
 */
export default async function StatementPrint({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string; id: string }>;
  searchParams: Promise<Query>;
}) {
  const [{ kind, id }, sp] = await Promise.all([params, searchParams]);
  const s = await getStatement(kind, id, sp);
  const q = new URLSearchParams(queryOf(sp));
  return (
    <>
      <PrintToolbar
        title={`Statement ${s.doc.number} · ${s.party.name} · ${s.from} – ${s.to}${s.issued ? "" : " (preview)"}`}
        backHref={backTo(sp.back, `/finance/ledger/${PARTY_PATH[kind as LedgerPartyKind]}/${id}`)}
        pdfHref={`/pdf/ledger-${kind}/${id}${q.size ? `?${q}` : ""}`}
      />
      <PaperSheet doc={s.doc as unknown as PaperDoc} brand={await docBrand()} watermark={s.issued ? null : "PREVIEW"} />
    </>
  );
}
