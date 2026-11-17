import type { ReactNode } from "react";
import { Mail, MessageCircle, Paperclip, Pencil, Phone } from "lucide-react";
import { ATTACHMENT_KIND_LABEL, CHANNEL_LABEL, PRIORITY_LABEL } from "@kebo/shared";
import { buttonClass, Card, cn } from "@kebo/ui";
import { OpenPanelButton } from "@/components/common/panel";
import { date } from "@/lib/format";
import type { DealDetail } from "@/lib/types";

/** A part of the request, as its window has it: its title, its own Edit (that part only), then what it says. */
function Part({ title, step, what, canEdit, className, children }: { title: string; step: string; what: string; canEdit: boolean; className?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className={cn("flex min-w-0 flex-col gap-1.5 px-5 py-4 max-sm:px-4", className)}>
      <h3 className="flex min-h-8 items-center justify-between gap-2 text-xs font-bold tracking-wide text-text-2 uppercase">
        {title}
        {canEdit && (
          <OpenPanelButton panel="edit-request" id={step} variant="secondary" size="xs" label={`Edit ${what}`} className="tracking-normal normal-case">
            <Pencil aria-hidden /> Edit
          </OpenPanelButton>
        )}
      </h3>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-text-2">{label}</span>
      <span className="text-right font-medium">{children ?? <span className="font-normal text-muted">Not said</span>}</span>
    </div>
  );
}

/**
 * The client's request on the Overview (design "the record page", 17 Nov): what Edit the request holds, in its
 * parts — who asked, the details, the files from them, what they need — each with an Edit that opens only that
 * part. The items follow in their own card.
 */
export function RequestCard({ d }: { d: DealDetail }) {
  const canEdit = d.allowed.edit;
  const contact = d.customer.contacts.find((c) => c.id === d.contactId) ?? d.customer.contacts.find((c) => c.isPrimary) ?? d.customer.contacts[0];
  const phone = contact?.whatsapp ?? contact?.phone ?? null;
  const way = buttonClass("secondary", "xs", "tracking-normal normal-case");
  return (
    <Card className="overflow-clip">
      <div className="flex min-h-14 items-center justify-between gap-3 border-b border-line px-5 py-3 max-sm:px-4">
        <h2 className="text-base font-bold text-text">The client’s request</h2>
        {canEdit && (
          <OpenPanelButton panel="edit-request" variant="secondary" size="sm">
            <Pencil aria-hidden /> Edit the request
          </OpenPanelButton>
        )}
      </div>
      <div className="grid border-b border-line md:grid-cols-[1.2fr_1fr_1fr] max-md:divide-y max-md:divide-line md:divide-x md:divide-line">
        <Part title="Who asked" step="customer" what="who asked" canEdit={canEdit}>
          {contact ? (
            <>
              <span className="text-sm font-semibold text-text">{contact.name}</span>
              {(contact.email || phone) && <span className="text-[13px] text-text-2 [overflow-wrap:anywhere]">{[contact.email, phone].filter(Boolean).join(" · ")}</span>}
              <span className="mt-1 flex flex-wrap gap-1.5">
                {phone && (
                  <a href={`tel:${phone.replace(/[^+\d]/g, "")}`} className={way}>
                    <Phone aria-hidden /> Call
                  </a>
                )}
                {phone && (
                  <a href={`https://wa.me/${phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className={way}>
                    <MessageCircle aria-hidden /> WhatsApp
                  </a>
                )}
                {contact.email && (
                  <a href={`mailto:${contact.email}`} className={way}>
                    <Mail aria-hidden /> Email
                  </a>
                )}
              </span>
            </>
          ) : (
            <span className="text-sm text-muted">Nobody named</span>
          )}
          <span className="mt-1 text-[13px] text-text-2">
            Came by {CHANNEL_LABEL[d.channel].toLowerCase()} · {date(d.createdAt)}
          </span>
        </Part>
        <Part title="Details" step="details" what="the details" canEdit={canEdit}>
          <Fact label="Category">{d.category || null}</Fact>
          <Fact label="Priority">{PRIORITY_LABEL[d.priority]}</Fact>
          <Fact label="Needed by">{d.requiredBy ? date(d.requiredBy) : null}</Fact>
        </Part>
        <Part title="Files from them" step="files" what="their files" canEdit={canEdit}>
          {d.attachments.length ? (
            <ul className="flex flex-col gap-1.5">
              {d.attachments.map((f) => (
                <li key={f.id} className="flex min-w-0 flex-col">
                  <a href={`/files/${f.id}?view=1`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary [overflow-wrap:anywhere] hover:underline">
                    <Paperclip className="size-3.5 shrink-0" aria-hidden />
                    {f.fileName}
                  </a>
                  <span className="pl-5 text-xs text-text-2">
                    {ATTACHMENT_KIND_LABEL[f.kind]} · {date(f.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-sm text-muted">None</span>
          )}
        </Part>
      </div>
      <Part title="What they need" step="details" what="what they need" canEdit={canEdit}>
        {d.requirements ? <p className="text-sm leading-relaxed whitespace-pre-line text-text">{d.requirements}</p> : <span className="text-sm text-muted">Not written</span>}
      </Part>
    </Card>
  );
}
