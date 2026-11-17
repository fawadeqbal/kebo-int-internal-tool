import { Mail, MessageCircle, Phone } from "lucide-react";
import { CHANNEL_LABEL, PRIORITY_LABEL } from "@kebo/shared";
import { buttonClass } from "@kebo/ui";
import { date, dateTime } from "@/lib/format";
import type { DealDetail } from "@/lib/types";
import type { EditsView } from "@/lib/types-edits";
import { HistoryButton, type HistoryEntry } from "@/components/edits/history-button";
import { BoxFacts as Facts, RecordBox } from "@/components/common/record-box";
import { FilesBox } from "./files-box";


/**
 * The client's request on the Overview (design rules 18 Nov): Customer and Details side by side, then the Items
 * (their own card) and Files — the boxes and names of the inquiry's steps, each fact once (the customer's name and
 * country are in the header; the responsible person in the panel).
 */
export function RequestBoxes({ d, edits }: { d: DealDetail; edits?: EditsView }) {
  const canEdit = d.allowed.edit;
  // Each box's own changes (who, when, old → new, why), then where it started.
  const history = (card: string, title: string) => {
    const entries: HistoryEntry[] = [
      ...(edits?.cards[card]?.edits ?? []).map((e) => ({ lines: e.changes, reason: e.reason, by: e.by, at: dateTime(e.at) })),
      { lines: ["Added with the inquiry"], reason: null, by: d.createdBy.name, at: dateTime(d.createdAt), start: true },
    ];
    return <HistoryButton title={title} entries={entries} allHref={`/inquiries/${d.id}/history`} />;
  };
  const contact = d.customer.contacts.find((c) => c.id === d.contactId) ?? d.customer.contacts.find((c) => c.isPrimary) ?? d.customer.contacts[0];
  const phone = contact?.whatsapp ?? contact?.phone ?? null;
  const way = buttonClass("secondary", "xs");
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <RecordBox title="Customer" step="customer" what="who asked" canEdit={canEdit} history={history("request.customer", "Customer")}>
        {contact ? (
          <div className="flex flex-col gap-1 px-5 pt-4 max-sm:px-4">
            <span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-text">
              {contact.name}
              {contact.isPrimary && <span className="rounded-full bg-primary-soft px-2 py-px text-[11.5px] font-semibold text-primary">Main contact</span>}
            </span>
            {(contact.email || phone) && <span className="text-[13px] text-text-2 [overflow-wrap:anywhere]">{[contact.email, phone].filter(Boolean).join(" · ")}</span>}
            <span className="mt-1.5 flex flex-wrap gap-1.5">
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
          </div>
        ) : (
          <p className="px-5 pt-4 text-sm text-muted max-sm:px-4">No contact named</p>
        )}
        <Facts
          rows={[
            ["Came by", `${CHANNEL_LABEL[d.channel]} · ${date(d.createdAt)}`],
            ["Needed by", d.requiredBy ? date(d.requiredBy) : null],
          ]}
        />
      </RecordBox>
      <RecordBox title="Details" step="details" what="the details" canEdit={canEdit} history={history("request.details", "Details")}>
        <Facts
          rows={[
            ["Category", d.category || null],
            ["Priority", PRIORITY_LABEL[d.priority]],
          ]}
        />
        <div className="flex flex-col gap-1 px-5 pb-4 max-sm:px-4">
          <span className="text-sm text-text-2">What they need</span>
          {d.requirements ? <p className="text-sm leading-relaxed whitespace-pre-line text-text">{d.requirements}</p> : <span className="text-sm text-muted">—</span>}
        </div>
      </RecordBox>
    </div>
  );
}

/** Files, under the items: what they sent (kind, when), each to open or download, and a drop area to add more. */
export function FilesCard({ d }: { d: DealDetail }) {
  return (
    <RecordBox
      title="Files"
      count={d.attachments.length ? String(d.attachments.length) : undefined}
      step="files"
      what="their files"
      canEdit={d.allowed.edit}
      history={
        d.attachments.length ? (
          <HistoryButton
            title="Files"
            allHref={`/inquiries/${d.id}/history`}
            entries={[...d.attachments]
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .map((f) => ({ lines: [`Added ${f.fileName}`], reason: null, by: null, at: dateTime(f.createdAt), start: true }))}
          />
        ) : undefined
      }
    >
      <FilesBox
        dealId={d.id}
        canAdd={d.allowed.edit}
        files={d.attachments.map((f) => ({ id: f.id, fileName: f.fileName, kind: f.kind, at: date(f.createdAt) }))}
      />
    </RecordBox>
  );
}
