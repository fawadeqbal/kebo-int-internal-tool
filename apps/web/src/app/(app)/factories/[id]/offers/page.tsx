import { Search, X } from "lucide-react";
import { LOST_REASON_LABEL } from "@kebo/shared";
import { ButtonLink, Card, DataRow, EmptyState, PhoneList, PhoneRow, RefCode, StatusBadge, Td, Th, THead } from "@kebo/ui";
import { requirePermission } from "@/lib/session";
import { factoryOf } from "@/lib/party-data";
import { date, whole } from "@/lib/format";
import type { FactoryDetail } from "@/lib/types-people";
import { DataTable } from "@/components/common/data-table";
import { FilterCard } from "@/components/common/filter-card";

export const metadata = { title: "Supplier offers" };

type Offer = FactoryDetail["quotes"][number];

const RESULTS = [
  { value: "won", label: "Won" },
  { value: "used", label: "In a quotation" },
  { value: "unused", label: "Not used yet" },
  { value: "lost", label: "Lost" },
];

/** What came of the offer: in a quotation (won when accepted), lost with the inquiry, or not used yet. */
function result(q: Offer): { key: string; label: string; meaning: "ok" | "info" | "bad" | "neutral" } {
  if (q.inquiry.stage === "lost")
    return {
      key: "lost",
      label: q.inquiry.lostReason ? `Lost · ${LOST_REASON_LABEL[q.inquiry.lostReason].toLowerCase()}` : "Lost",
      meaning: "bad",
    };
  if (q.usedIn?.accepted) return { key: "won", label: `${q.usedIn.refNo} · won`, meaning: "ok" };
  if (q.usedIn) return { key: "used", label: `${q.usedIn.refNo} R${q.usedIn.revision}`, meaning: "info" };
  return { key: "unused", label: "Not used yet", meaning: "neutral" };
}

/**
 * The supplier's Offers tab (board "Supplier — Offers tab"): search offers and models, Inquiry and Result; each
 * offer with its inquiry, their reference, when it came, until when it holds, the basis, lines, total, lead
 * time and the quotation it went into.
 */
export default async function FactoryOffers({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; inquiry?: string; result?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  await requirePermission("sourcing.manage");
  const f = await factoryOf(id);
  const q = sp.q?.trim().toLowerCase();
  const inquiries = [...new Map(f.quotes.map((x) => [x.inquiry.id, x.inquiry])).values()];
  const rows = f.quotes.filter(
    (x) =>
      (!q || [x.inquiry.refNo, x.inquiry.title, x.reference, x.words].some((v) => v?.toLowerCase().includes(q))) &&
      (!sp.inquiry || x.inquiry.id === sp.inquiry) &&
      (!sp.result || result(x).key === sp.result),
  );
  const filtered = !!(q || sp.inquiry || sp.result);
  const base = `/factories/${f.id}/offers`;
  const basis = (x: Offer) => [x.basis, x.basisPlace].filter(Boolean).join(" ") || "—";

  return (
    <>
      <FilterCard
        search="Search offer, model…"
        value={sp.q}
        clearHref={base}
        selects={[
          { name: "inquiry", label: "Inquiry", value: sp.inquiry, options: inquiries.map((i) => ({ value: i.id, label: i.refNo })) },
          { name: "result", label: "Result", value: sp.result, options: RESULTS },
        ]}
      />
      <Card className="overflow-clip p-0">
        {rows.length === 0 ? (
          <EmptyState
            title={filtered ? "No offers match" : "No offers yet"}
            description={
              filtered
                ? "Try another word, inquiry or result."
                : "Prices are recorded on an inquiry, under Factory prices. Open an inquiry that needs prices and ask this supplier."
            }
            action={
              filtered ? (
                <ButtonLink href={base}>
                  <X aria-hidden /> Clear filters
                </ButtonLink>
              ) : (
                <ButtonLink href="/inquiries?stage=sourcing">
                  <Search aria-hidden /> Inquiries waiting for prices
                </ButtonLink>
              )
            }
          />
        ) : (
          <>
            <PhoneList label="Offers">
              {rows.map((x) => {
                const r = result(x);
                return (
                  <PhoneRow
                    key={x.id}
                    href={`/inquiries/${x.inquiry.id}/sourcing`}
                    title={x.inquiry.refNo}
                    line={[date(x.receivedOn), basis(x), `${x._count.lines} lines`].join(" · ")}
                    status={<StatusBadge meaning={r.meaning}>{r.label}</StatusBadge>}
                    figure={whole(x.total, x.currency)}
                  />
                );
              })}
            </PhoneList>
            <DataTable label="Offers" className="max-sm:hidden">
              <table className="w-full min-w-[1100px] text-[13px]">
                <THead>
                  <tr>
                    <Th>Inquiry</Th>
                    <Th>Their ref.</Th>
                    <Th>Received</Th>
                    <Th>Valid until</Th>
                    <Th>Basis</Th>
                    <Th className="text-right">Lines</Th>
                    <Th className="text-right">Total</Th>
                    <Th>Lead time</Th>
                    <Th>Used in</Th>
                  </tr>
                </THead>
                <tbody>
                  {rows.map((x) => {
                    const r = result(x);
                    return (
                      <DataRow key={x.id} href={`/inquiries/${x.inquiry.id}/sourcing`}>
                        <Td>
                          <RefCode href={`/inquiries/${x.inquiry.id}/sourcing`}>{x.inquiry.refNo}</RefCode>
                        </Td>
                        <Td>{x.reference ?? "—"}</Td>
                        <Td className="whitespace-nowrap">{date(x.receivedOn)}</Td>
                        <Td className="whitespace-nowrap">{x.validUntil ? date(x.validUntil) : "—"}</Td>
                        <Td className="whitespace-nowrap">{basis(x)}</Td>
                        <Td className="text-right tabular">{x._count.lines}</Td>
                        <Td className="text-right whitespace-nowrap tabular">{whole(x.total, x.currency)}</Td>
                        <Td>{x.leadTime ?? "—"}</Td>
                        <Td>
                          <StatusBadge meaning={r.meaning}>{r.label}</StatusBadge>
                        </Td>
                      </DataRow>
                    );
                  })}
                </tbody>
              </table>
            </DataTable>
          </>
        )}
      </Card>
    </>
  );
}
