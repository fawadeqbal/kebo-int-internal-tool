import { Plus, Star } from "lucide-react";
import { can } from "@kebo/shared";
import { requireUser } from "@/lib/session";
import { customerOf } from "@/lib/party-data";
import { getSettings } from "@/lib/loaders";
import { OpenPanelButton } from "@/components/common/panel";
import { RecordEmpty, RecordListCard, RecordRow } from "@/components/common/record";
import { saveCustomerAction } from "../../actions";
import { CustomerPanel } from "../../customer-panel";
import { currenciesFrom } from "../../currencies";

export const metadata = { title: "Customer contacts" };

/** The customer's Contacts tab: every person we can reach there, the primary first; ✎ adds or changes them. */
export default async function CustomerContacts({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ panel?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await requireUser();
  const canEdit = can(me, "customers.manage");
  const editing = canEdit && sp.panel === "edit-customer";
  const [c, settings] = await Promise.all([customerOf(id), editing ? getSettings() : null]);
  const people = [...c.contacts].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));

  return (
    <>
      <RecordListCard
        title="Contacts"
        count={people.length}
        description={people.length ? "The primary contact is on their papers and in Overview" : undefined}
        action={
          canEdit && (
            <OpenPanelButton panel="edit-customer" id={c.id} variant="ghost" size="sm" label="Add or change contacts">
              <Plus aria-hidden /> Add or change
            </OpenPanelButton>
          )
        }
        empty={<RecordEmpty title="No contacts yet">Add at least one person you can reach.</RecordEmpty>}
      >
        {people.map((p) => (
          <RecordRow
            key={p.id}
            title={
              <span className="flex items-center gap-1.5">
                {p.name}
                {p.isPrimary && (
                  <span className="inline-flex items-center gap-0.5 text-xs font-medium text-primary">
                    <Star aria-hidden className="size-3 fill-current" /> Primary
                  </span>
                )}
              </span>
            }
            sub={
              [p.position, p.email, p.phone, p.whatsapp && p.whatsapp !== p.phone ? `WhatsApp ${p.whatsapp}` : null, p.wechat ? `WeChat ${p.wechat}` : null]
                .filter(Boolean)
                .join(" · ") || "No way to reach them yet"
            }
          />
        ))}
      </RecordListCard>
      {editing && settings && <CustomerPanel action={saveCustomerAction.bind(null, c.id)} customer={c} currencies={currenciesFrom(settings)} onRecord />}
    </>
  );
}
