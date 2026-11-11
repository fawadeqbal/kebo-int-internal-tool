import { Plus } from "lucide-react";
import { can } from "@kebo/shared";
import { ButtonLink, StageBadge } from "@kebo/ui";
import { requireUser } from "@/lib/session";
import { customerOf } from "@/lib/party-data";
import { date } from "@/lib/format";
import { RowMenu } from "@/components/common/more-menu";
import { RecordEmpty, RecordListCard, RecordRow } from "@/components/common/record";
import { OPEN_STAGES } from "../shared";

export const metadata = { title: "Customer inquiries" };

/** The customer's Inquiries tab: every request for prices, newest first, with its stage. */
export default async function CustomerInquiries({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const c = await customerOf(id);
  const canAsk = can(me, "inquiries.create");
  const newInquiry = `/inquiries/new?customer=${c.id}`;
  const open = c.inquiries.filter((d) => OPEN_STAGES.includes(d.stage)).length;
  const won = c.inquiries.filter((d) => d.stage === "won").length;
  const lost = c.inquiries.filter((d) => d.stage === "lost").length;

  return (
    <RecordListCard
      title="Inquiries"
      count={c.inquiries.length}
      description={
        c.inquiries.length ? `${open} open · ${won} won · ${lost} lost${can(me, "inquiries.viewAll") ? "" : " · the ones you handle or created"}` : undefined
      }
      empty={
        <RecordEmpty
          title="No inquiries yet"
          action={
            canAsk && (
              <ButtonLink href={newInquiry} size="sm">
                <Plus aria-hidden /> Add their first inquiry
              </ButtonLink>
            )
          }
        >
          Every request for prices from this customer shows here, with its stage.
        </RecordEmpty>
      }
    >
      {c.inquiries.map((d) => (
        <RecordRow
          key={d.id}
          href={`/inquiries/${d.id}`}
          title={d.refNo}
          sub={[d.title, d.assignee?.name ?? "nobody handles it yet"].filter(Boolean).join(" · ")}
          status={<StageBadge stage={d.stage} onHold={d.onHold} />}
          figure={<span className="text-xs text-text-2">{date(d.createdAt)}</span>}
          menu={
            <RowMenu
              label={`Actions for ${d.refNo}`}
              items={[
                { label: "Open", href: `/inquiries/${d.id}` },
                { label: "Copy link", copy: `/inquiries/${d.id}` },
              ]}
            />
          }
        />
      ))}
    </RecordListCard>
  );
}
