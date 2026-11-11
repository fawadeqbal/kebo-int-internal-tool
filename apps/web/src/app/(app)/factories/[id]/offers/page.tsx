import { ButtonLink } from "@kebo/ui";
import { requirePermission } from "@/lib/session";
import { factoryOf } from "@/lib/party-data";
import { date, plural } from "@/lib/format";
import { RowMenu } from "@/components/common/more-menu";
import { RecordEmpty, RecordListCard, RecordRow } from "@/components/common/record";

export const metadata = { title: "Supplier price offers" };

/** The supplier's Price offers tab: every price it gave on our inquiries, newest first. */
export default async function FactoryOffers({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePermission("sourcing.manage");
  const f = await factoryOf(id);
  return (
    <RecordListCard
      title="Price offers"
      count={f.quotes.length}
      description={f.quotes.length ? "Prices it gave on our inquiries, newest first" : undefined}
      empty={
        <RecordEmpty
          title="No prices yet"
          action={
            <ButtonLink href="/inquiries?stage=sourcing" size="sm">
              Inquiries waiting for prices
            </ButtonLink>
          }
        >
          Prices are recorded on an inquiry, under Factory prices. Open an inquiry that needs prices and ask this supplier.
        </RecordEmpty>
      }
    >
      {f.quotes.map((q) => (
        <RecordRow
          key={q.id}
          href={`/inquiries/${q.inquiry.id}/sourcing`}
          title={q.inquiry.refNo}
          sub={q.inquiry.title}
          figure={
            <span className="text-xs text-text-2">
              {plural(q._count.lines, "line")} · {q.currency} · {date(q.receivedOn)}
            </span>
          }
          menu={
            <RowMenu
              label={`Actions for ${q.inquiry.refNo}`}
              items={[
                { label: "Open the prices", href: `/inquiries/${q.inquiry.id}/sourcing` },
                { label: "Open the inquiry", href: `/inquiries/${q.inquiry.id}` },
                { label: "Copy link", copy: `/inquiries/${q.inquiry.id}/sourcing` },
              ]}
            />
          }
        />
      ))}
    </RecordListCard>
  );
}
