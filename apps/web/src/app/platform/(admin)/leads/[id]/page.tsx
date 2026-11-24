import Link from "next/link";
import { Building2 } from "lucide-react";
import { COMPANY_KIND_LABEL, LEAD_SOURCE_LABEL, LEAD_STATUS_LABEL, suggestSlug } from "@kebo/shared";
import { ButtonLink, buttonClass, Card, EmptyState, StatusBadge, EmptyLine, CardHeader, linkClass, cn, subTitleClass } from "@kebo/ui";
import { platformApi } from "@/lib/api";
import { loadPlatform } from "@/lib/platform";
import { date, dateTime } from "@/lib/format";
import type { LeadDetail, LeadStatus, Plan } from "@/lib/types-platform";
import { MoreMenu, type MenuEntry } from "@/components/common/more-menu";
import { GroupCard } from "@/components/platform/group-card";
import { CompanyStatusBadge } from "@/components/platform/badges";
import { deleteLeadAction, giveDemoAction, leadNoteAction, updateLeadAction } from "@/app/platform/actions";
import { OpenPanelButton } from "@/components/common/panel";
import { NoteForm } from "./forms";
import { LeadPanels, ProgressSteps } from "./panels";
import { cache } from "react";
import { RecordShell } from "@/components/records/record-frame";
import { RecordTop } from "@/components/records/record-page";
import { EmailText } from "@/components/common/email-text";

/** The client inquiry, read once per request (the page and its tab title). */
const leadOf = cache((id: string) => loadPlatform(() => platformApi.get<LeadDetail>(`/leads/${id}`)));

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: `${(await leadOf((await params).id)).companyName} · Client inquiry` };
}

const MEANING: Record<LeadStatus, "info" | "neutral" | "ok" | "bad"> = {
  new: "info",
  contacted: "neutral",
  demo: "info",
  client: "ok",
  lost: "bad",
};

/**
 * A client inquiry (design system: record frame, approved page 30). Header:
 * the company, its status, one summary line; the one primary "Make a
 * company" (or "Make it a client" once they have a demo, "Open their company"
 * once they are one), "Give a demo" beside it, ⋯ (Mark as lost…, Delete…
 * last, red). Main column: Progress (New → Contacted → Demo given → Client /
 * Lost, with the next follow-up), Who and What they need with ✎ Edit in the
 * side panel. Beside it: their demo, notes, history.
 */
export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [l, plans] = await Promise.all([
    leadOf(id),
    platformApi.get<Plan[]>("/plans"),
  ]);
  const company = l.company && l.company.status !== "deleted" ? l.company : null;
  const suggested = `${suggestSlug(l.companyName).slice(0, 25)}-demo`;

  const primary = !company ? (
    <ButtonLink href={`/platform/companies/new?lead=${id}&kind=client`} variant="strong">
      <Building2 aria-hidden /> Make a company
    </ButtonLink>
  ) : company.kind !== "client" ? (
    <ButtonLink href={`/platform/companies/${company.id}?section=plan&panel=make-real`} variant="strong">
      <Building2 aria-hidden /> Make it a client
    </ButtonLink>
  ) : (
    <ButtonLink href={`/platform/companies/${company.id}`} variant="strong">
      <Building2 aria-hidden /> Open their company
    </ButtonLink>
  );
  const more: MenuEntry[] = [
    ...(company
      ? [{ label: company.kind === "client" ? "Open their company" : "Open their demo", href: `/platform/companies/${company.id}` }]
      : []),
    { label: "Copy link", copy: `/platform/leads/${id}` },
    ...(l.status !== "lost" ? [{ separator: true } as const, { label: "Mark as lost…", panel: "lost" }] : []),
    { separator: true } as const,
    {
      label: "Delete…",
      danger: true,
      confirm: {
        title: `Delete the client inquiry from ${l.companyName}?`,
        body: "Its notes go too. Their demo or company stays.",
        confirmLabel: "Delete the inquiry",
      },
      action: deleteLeadAction.bind(null, id),
    },
  ];
  const summary = [
    l.country,
    l.teamSize ? `${l.teamSize} people` : null,
    `asked ${date(l.createdAt)} · ${LEAD_SOURCE_LABEL[l.source].toLowerCase()}`,
    l.channel ? `from ${l.channel}` : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-4">
      <RecordShell
        top={
          <RecordTop
            header={{
              backHref: "/platform/leads",
              backLabel: "Client inquiries",
              title: l.companyName,
              badge: <StatusBadge meaning={MEANING[l.status]}>{LEAD_STATUS_LABEL[l.status]}</StatusBadge>,
              summary: summary.join(" · "),
              primary: primary,
              papers: !company ? <OpenPanelButton size="sm" panel="give-demo">Give a demo</OpenPanelButton> : undefined,
              more: (
                <MoreMenu
        label={`More for ${l.companyName}`}
        items={more}
        phoneItems={!company ? [{ label: "Give a demo", panel: "give-demo" }] : []}
      />
              ),
            }}
          />
        }
        panelLabel="Beside the client inquiry"
        panel={
          <>
          <Card className="overflow-clip" aria-labelledby="demo-title">
            <CardHeader
              titleId="demo-title"
              title={company?.kind === "client" ? "Their company" : "Demo"}
              description={company ? "made for them" : "none yet"}
              actions={
                company && (
                  <Link href={`/platform/companies/${company.id}`} className={buttonClass("ghost", "sm", "text-text-2")}>
                    Open {company.kind === "client" ? "company" : "demo"}
                  </Link>
                )
              }
            />
            {company ? (
              <dl className="divide-y divide-line px-4">
                {[
                  { label: "Company", value: <span className="font-mono">{company.slug}</span> },
                  { label: "Kind", value: COMPANY_KIND_LABEL[company.kind] },
                  { label: "Status", value: <CompanyStatusBadge status={company.status} /> },
                  ...(company.kind !== "client" && company.endsAt ? [{ label: "Ends", value: dateTime(company.endsAt) }] : []),
                  {
                    label: "Signed in",
                    value: company.signIns === null ? "—" : `${company.signIns} ${company.signIns === 1 ? "time" : "times"}`,
                  },
                ].map((r) => (
                  <div key={r.label} className="flex items-baseline justify-between gap-4 py-2.5">
                    <dt className="text-xs text-text-2">{r.label}</dt>
                    <dd className="text-right text-sm font-medium">{r.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <EmptyState
                framed
                title="No demo yet"
                description="Give them a demo (their own space with sample data for a few days), or make them a company straight away."
              />
            )}
          </Card>
          <Card className="overflow-clip" aria-labelledby="notes-title">
            <div className="border-b border-line px-4 py-3">
              <h2 id="notes-title" className={subTitleClass}>
                Notes · {l.notes.length}
              </h2>
              <p className="mt-0.5 text-xs text-muted">calls, emails, what they said</p>
            </div>
            <div className="px-4 py-3">
              <NoteForm action={leadNoteAction.bind(null, id)} />
            </div>
            {l.notes.length > 0 && (
              <ol className="divide-y divide-line border-t border-line px-4">
                {l.notes.map((n) => (
                  <li key={n.id} className="py-2.5">
                    <p className="text-sm whitespace-pre-wrap">{n.text}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      <span className="font-medium text-text-2">{n.byName ?? "—"}</span> · {dateTime(n.createdAt)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
          <Card className="overflow-clip" aria-labelledby="history-title">
            <div className="border-b border-line px-4 py-3">
              <h2 id="history-title" className={subTitleClass}>
                History
              </h2>
              <p className="mt-0.5 text-xs text-muted">what was done on the platform</p>
            </div>
            {l.log.length ? (
              <ol className="divide-y divide-line px-4">
                {l.log.map((e) => (
                  <li key={e.id} className="py-2.5">
                    <p className="text-sm">{e.summary}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      <span className="font-medium text-text-2">{e.adminName ?? "Automatic rules"}</span> · {dateTime(e.at)}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyLine className="px-4 py-3">Nothing yet.</EmptyLine>
            )}
          </Card>
        </>
        }
      >
          <Card className="overflow-clip" aria-labelledby="progress-title">
            <div className="border-b border-line px-4 py-3">
              <h2 id="progress-title" className={subTitleClass}>
                Progress
              </h2>
              <p className="mt-0.5 text-xs text-muted">click a step to move it there</p>
            </div>
            <div className="flex flex-col gap-2 px-4 py-3">
              <ProgressSteps status={l.status} action={updateLeadAction.bind(null, id)} />
              {l.status === "lost" && l.lostReason && <p className="text-xs text-bad">Lost: {l.lostReason}</p>}
              <p className="text-xs text-text-2">
                {l.followUpOn ? (
                  <>
                    Next: follow up <b className="text-text">{date(l.followUpOn)}</b>
                  </>
                ) : (
                  "No follow-up yet"
                )}{" "}
                ·{" "}
                <OpenPanelButton panel="follow-up" variant="link" className="text-xs" label={l.followUpOn ? "change the follow-up date" : "set a follow-up date"}>
                  {l.followUpOn ? "change" : "set a follow-up date"}
                </OpenPanelButton>
              </p>
            </div>
          </Card>
          <GroupCard
            id="who"
            title="Who"
            description="from their request"
            panel="edit-who"
            editLabel="Edit who"
            items={[
              { label: "Company", value: l.companyName },
              { label: "Contact", value: l.name },
              {
                label: "Email",
                value: (
                  <a href={`mailto:${l.email}`} className={cn(linkClass, "break-words")}>
                    <EmailText email={l.email} />
                  </a>
                ),
              },
              { label: "Phone / WhatsApp", value: l.phone },
              { label: "Country", value: l.country },
              { label: "Team size", value: l.teamSize },
            ]}
          />
          <GroupCard
            id="need"
            title="What they need"
            description="in their words, and yours"
            panel="edit-need"
            editLabel="Edit what they need"
            columns={2}
            items={[
              {
                label: "What they need",
                value: l.message ? <span className="font-normal whitespace-pre-wrap">{l.message}</span> : null,
                wide: true,
              },
              { label: "Came from", value: l.channel ?? LEAD_SOURCE_LABEL[l.source], readOnly: true },
              ...(l.origin?.campaign
                ? [{ label: "Campaign", value: [l.origin.campaign, l.origin.medium].filter(Boolean).join(", "), readOnly: true }]
                : []),
              ...(l.origin?.cta ? [{ label: "Button pressed", value: l.origin.cta, readOnly: true }] : []),
            ]}
          />
      </RecordShell>
      <LeadPanels l={l} plans={plans} suggested={suggested} update={updateLeadAction.bind(null, id)} demo={giveDemoAction.bind(null, id)} />
    </div>
  );
}
