import { Plus, X } from "lucide-react";
import { can, CHANNEL_LABEL, INQUIRY_STAGE_LABEL, INQUIRY_STAGE_TONE, LOST_REASON_LABEL, type InquiryStage } from "@kebo/shared";
import { ButtonLink, Card, DataRow, EmptyState, PhoneList, PhoneRow, RefCode, StatusBadge, Td, Th, THead } from "@kebo/ui";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { customerOf } from "@/lib/party-data";
import { date, whole } from "@/lib/format";
import type { DealRow, Paged } from "@/lib/types";
import { DataTable } from "@/components/common/data-table";
import { FilterCard } from "@/components/common/filter-card";

export const metadata = { title: "Customer inquiries" };

const STAGES: InquiryStage[] = ["new", "sourcing", "quoted", "won", "lost"];

/** "Won", "Sourcing", "Lost · price too high". */
function Stage({ d }: { d: DealRow }) {
  const label =
    d.stage === "lost" && d.lostReason ? `Lost · ${LOST_REASON_LABEL[d.lostReason].toLowerCase()}` : INQUIRY_STAGE_LABEL[d.stage];
  return (
    <StatusBadge meaning={d.stage === "lost" ? "bad" : INQUIRY_STAGE_TONE[d.stage]}>{d.onHold ? `${label} · on hold` : label}</StatusBadge>
  );
}

/**
 * The customer's Inquiries tab (board "Customer — Inquiries tab"): search and Status; each inquiry with its
 * title, category, when it came, the quotation (number and revision), its value and where it is.
 */
export default async function CustomerInquiries({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const me = await requireUser();
  const status = STAGES.find((x) => x === sp.status);
  const [c, list] = await Promise.all([
    customerOf(id),
    api.get<Paged<DealRow>>("/inquiries", { customerId: id, q: sp.q?.trim() || undefined, stage: status, pageSize: 100 }).catch(() => null),
  ]);
  const rows = list?.rows ?? [];
  const filtered = !!(sp.q || status);
  const base = `/customers/${c.id}/inquiries`;
  const value = (d: DealRow) => (d.quotation?.latest ? whole(d.quotation.latest.total, d.quotation.latest.currency) : "—");
  const quote = (d: DealRow) => (d.quotation ? `${d.quotation.refNo}${d.quotation.latest ? ` R${d.quotation.latest.number}` : ""}` : null);

  return (
    <>
      <FilterCard
        search="Search inquiry…"
        value={sp.q}
        clearHref={base}
        selects={[
          { name: "status", label: "Status", value: status, options: STAGES.map((x) => ({ value: x, label: INQUIRY_STAGE_LABEL[x] })) },
        ]}
      />
      <Card className="overflow-clip p-0">
        {rows.length === 0 ? (
          <EmptyState
            title={filtered ? "No inquiries match" : "No inquiries yet"}
            description={
              filtered ? "Try another word or status." : "Each request for prices from this customer shows here, with its quotation."
            }
            action={
              filtered ? (
                <ButtonLink href={base}>
                  <X aria-hidden /> Clear filters
                </ButtonLink>
              ) : can(me, "inquiries.create") ? (
                <ButtonLink href={`/inquiries/new?customer=${c.id}`}>
                  <Plus aria-hidden /> New inquiry
                </ButtonLink>
              ) : undefined
            }
          />
        ) : (
          <>
            <PhoneList label="Inquiries">
              {rows.map((d) => (
                <PhoneRow
                  key={d.id}
                  href={`/inquiries/${d.id}`}
                  title={d.refNo}
                  line={[d.title, date(d.createdAt)].join(" · ")}
                  status={<Stage d={d} />}
                  figure={value(d)}
                />
              ))}
            </PhoneList>
            <DataTable label="Inquiries" className="max-sm:hidden" tableClassName="min-w-[980px] text-[13px]">
                <THead>
                  <tr>
                    <Th>Inquiry</Th>
                    <Th>Title</Th>
                    <Th>Category</Th>
                    <Th>Received</Th>
                    <Th>Quotation</Th>
                    <Th className="text-right">Value</Th>
                    <Th>Status</Th>
                  </tr>
                </THead>
                <tbody>
                  {rows.map((d) => (
                    <DataRow key={d.id} href={`/inquiries/${d.id}`}>
                      <Td>
                        <RefCode href={`/inquiries/${d.id}`}>{d.refNo}</RefCode>
                      </Td>
                      <Td>
                        <span className="block font-semibold">{d.title}</span>
                        <span className="block text-xs text-text-2">Ask: {CHANNEL_LABEL[d.channel].toLowerCase()}</span>
                      </Td>
                      <Td>{d.category}</Td>
                      <Td className="whitespace-nowrap">{date(d.createdAt)}</Td>
                      <Td>{quote(d) ? <RefCode href={`/inquiries/${d.id}/quotation`}>{quote(d)}</RefCode> : "—"}</Td>
                      <Td className="text-right whitespace-nowrap tabular">{value(d)}</Td>
                      <Td>
                        <Stage d={d} />
                      </Td>
                    </DataRow>
                  ))}
                </tbody>
            </DataTable>
          </>
        )}
      </Card>
    </>
  );
}
