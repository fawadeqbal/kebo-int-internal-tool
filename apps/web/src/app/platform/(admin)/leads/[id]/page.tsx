import Link from "next/link";
import { Building2 } from "lucide-react";
import { COMPANY_KIND_LABEL, LEAD_SOURCE_LABEL, LEAD_STATUS_LABEL, suggestSlug } from "@kebo/shared";
import { ButtonLink, buttonClass, Card, EmptyState, PageHeader, StatusBadge } from "@kebo/ui";
import { platformApi } from "@/lib/api";
import { loadPlatform } from "@/lib/platform";
import { date, dateTime } from "@/lib/format";
import type { LeadDetail, LeadStatus, Plan } from "@/lib/types-platform";
import { MoreMenu, type MenuEntry } from "@/components/common/more-menu";
import { GroupCard } from "@/components/platform/group-card";
import { CompanyStatusBadge } from "@/components/platform/badges";
import { deleteLeadAction, giveDemoAction, leadNoteAction, updateLeadAction } from "@/app/platform/actions";
import { PanelButton } from "../../companies/[id]/cards";
import { NoteForm } from "./forms";
import { LeadPanels, ProgressSteps } from "./panels";

export const metadata = { title: "Client inquiry" };

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
    loadPlatform(() => platformApi.get<LeadDetail>(`/leads/${id}`)),
    platformApi.get<Plan[]>("/plans"),
  ]);
  const company = l.company && l.company.status !== "deleted" ? l.company : null;
  const suggested = `${suggestSlug(l.companyName).slice(0, 25)}-demo`;

  const primary = !company ? (
    <ButtonLink href={`/platform/companies/new?lead=${id}&kind=client`} variant="primary">
      <Building2 aria-hidden /> Make a company
    </ButtonLink>
  ) : company.kind !== "client" ? (
    <ButtonLink href={`/platform/companies/${company.id}?section=plan&panel=make-real`} variant="primary">
      <Building2 aria-hidden /> Make it a client
    </ButtonLink>
  ) : (
    <ButtonLink href={`/platform/companies/${company.id}`} variant="primary">
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
      <PageHeader
        backHref="/platform/leads"
        backLabel="Client inquiries"
        phoneStack
        title={l.companyName}
        badge={<StatusBadge meaning={MEANING[l.status]}>{LEAD_STATUS_LABEL[l.status]}</StatusBadge>}
        summary={summary.join(" · ")}
        primary={primary}
        papers={!company ? <PanelButton panel="give-demo">Give a demo</PanelButton> : undefined}
        more={
          <MoreMenu
            label={`More for ${l.companyName}`}
            items={more}
            phoneItems={!company ? [{ label: "Give a demo", panel: "give-demo" }] : []}
          />
        }
      />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="overflow-clip" aria-labelledby="progress-title">
            <div className="border-b border-line px-4 py-3">
              <h2 id="progress-title" className="text-sm font-semibold">
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
                <PanelButton panel="follow-up" variant="link" label={l.followUpOn ? "change the follow-up date" : "set a follow-up date"}>
                  {l.followUpOn ? "change" : "set a follow-up date"}
                </PanelButton>
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
                  <a href={`mailto:${l.email}`} className="break-all text-primary hover:underline">
                    {l.email}
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
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="overflow-clip" aria-labelledby="demo-title">
            <div className="flex min-h-14 items-start justify-between gap-3 border-b border-line px-4 py-3">
              <div>
                <h2 id="demo-title" className="text-sm font-semibold">
                  {company?.kind === "client" ? "Their company" : "Demo"}
                </h2>
                <p className="mt-0.5 text-xs text-muted">{company ? "made for them" : "none yet"}</p>
              </div>
              {company && (
                <Link
                  href={`/platform/companies/${company.id}`}
                  className={buttonClass("ghost", "sm", "h-8 px-2.5 text-[13px] text-text-2")}
                >
                  Open {company.kind === "client" ? "company" : "demo"}
                </Link>
              )}
            </div>
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
              <h2 id="notes-title" className="text-sm font-semibold">
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
              <h2 id="history-title" className="text-sm font-semibold">
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
              <p className="px-4 py-3 text-sm text-muted">Nothing yet.</p>
            )}
          </Card>
        </div>
      </div>
      <LeadPanels l={l} plans={plans} suggested={suggested} update={updateLeadAction.bind(null, id)} demo={giveDemoAction.bind(null, id)} />
    </div>
  );
}
