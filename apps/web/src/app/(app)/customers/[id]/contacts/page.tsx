import { Mail, MessageCircle, Pencil, Phone } from "lucide-react";
import { can } from "@kebo/shared";
import { Badge, Card, CardHeader, EmptyState } from "@kebo/ui";
import { requireUser } from "@/lib/session";
import { customerOf } from "@/lib/party-data";
import { PanelButton } from "@/components/orders/step-view";
import { ConfirmAction } from "@/components/people/confirm-action";
import { ContactForm } from "@/components/people/contact-form";
import { makePrimaryContactAction, removeContactAction, saveContactAction } from "../../actions";

export const metadata = { title: "Customer contacts" };

/**
 * The customer's Contacts tab (board "Customer — Contacts tab"): a card per person (the primary first, marked),
 * each way to reach them, Edit and Make primary; the New contact card at the side.
 */
export default async function CustomerContacts({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const canEdit = can(me, "customers.manage");
  const c = await customerOf(id);
  const people = [...c.contacts].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      {people.length === 0 ? (
        <Card>
          <EmptyState
            title="No contacts yet"
            description="Add the people you deal with there: how to reach them shows on their papers and in Overview."
          />
        </Card>
      ) : (
        <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr))]">
          {people.map((p) => (
            <Card key={p.id} className="flex flex-col gap-2 p-5 text-sm">
              <div className="flex items-start justify-between gap-2">
                <strong>{p.name}</strong>
                {p.isPrimary && <Badge tone="ok">Primary</Badge>}
              </div>
              {p.position && <span className="text-[13px] text-text-2">{p.position}</span>}
              {p.email && (
                <a href={`mailto:${p.email}`} className="flex items-center gap-2 break-all hover:text-primary">
                  <Mail className="size-[15px] shrink-0 text-muted" aria-hidden />
                  {p.email}
                </a>
              )}
              {p.phone && (
                <a href={`tel:${p.phone}`} className="flex items-center gap-2 hover:text-primary">
                  <Phone className="size-[15px] shrink-0 text-muted" aria-hidden />
                  {p.phone}
                </a>
              )}
              {p.whatsapp && (
                <a
                  href={`https://wa.me/${p.whatsapp.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 hover:text-primary"
                >
                  <MessageCircle className="size-[15px] shrink-0 text-muted" aria-hidden />
                  WhatsApp {p.whatsapp}
                </a>
              )}
              {p.wechat && (
                <span className="flex items-center gap-2">
                  <MessageCircle className="size-[15px] shrink-0 text-muted" aria-hidden />
                  WeChat {p.wechat}
                </span>
              )}
              {canEdit && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1.5">
                  <PanelButton
                    size="sm"
                    icon={<Pencil aria-hidden />}
                    label="Edit"
                    title={`Edit ${p.name}`}
                    body={
                      <div className="flex flex-col gap-4 p-5">
                        <ContactForm action={saveContactAction.bind(null, c.id, p.id)} contact={p} />
                        {people.length > 1 && (
                          <ConfirmAction
                            action={removeContactAction.bind(null, c.id, p.id)}
                            confirm={`Remove ${p.name} from ${c.name}?`}
                            label="Remove this contact"
                            pendingText="Removing…"
                            variant="danger-ghost"
                            size="sm"
                          />
                        )}
                      </div>
                    }
                  />
                  {!p.isPrimary && (
                    <ConfirmAction
                      action={makePrimaryContactAction.bind(null, c.id, p.id)}
                      label="Make primary"
                      pendingText="Saving…"
                      variant="ghost"
                      size="sm"
                    />
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      {canEdit && (
        <Card>
          <CardHeader title="New contact" />
          <div className="p-5">
            <ContactForm action={saveContactAction.bind(null, c.id, null)} />
          </div>
        </Card>
      )}
    </div>
  );
}
