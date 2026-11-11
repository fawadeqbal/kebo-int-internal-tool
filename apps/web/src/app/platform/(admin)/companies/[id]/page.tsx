import Link from "next/link";
import { Download, LogIn } from "lucide-react";
import { COMPANY_KIND_LABEL } from "@kebo/shared";
import { Alert, Banner, buttonClass, PageHeader, SectionList, StatusBadge, toPage } from "@kebo/ui";
import { todayIn } from "@kebo/utils";
import { platformApi } from "@/lib/api";
import { loadPlatform, readFlash } from "@/lib/platform";
import { date, TZ } from "@/lib/format";
import type { CompanyDetail, CompanyHistory, Plan } from "@/lib/types-platform";
import { MoreMenu, type MenuEntry } from "@/components/common/more-menu";
import {
  adminPasswordAction,
  companyModulesAction,
  companyStatusAction,
  deleteCompanyAction,
  endAction,
  extendAction,
  makeRealAction,
  openCompanyAction,
  paymentAction,
  removePaymentAction,
  updateCompanyAction,
} from "@/app/platform/actions";
import { CopyLink } from "./forms";
import { headline, SECTIONS, sectionHref, sectionOf } from "./model";
import { CompanyPanels, type SavedCard } from "./panels";
import { BillingSection, DetailsSection, HistorySection, OverviewSection, PeopleSection, PlanSection } from "./sections";

export const metadata = { title: "Company" };

type Search = { section?: string; kind?: string; page?: string; saved?: string };

/**
 * A company, as the platform admin runs it (design system: record frame with
 * a section list, approved page 30). Header: its name and where it stands,
 * one summary line, Export, the one primary "Open company" and ⋯ (switch on /
 * off, read-only, back to the rules, end a demo, the client inquiry; Delete
 * last, in red). Sections (?section=): Overview · People · Plan & modules ·
 * Billing · Details · History; each change happens in a side panel.
 */
export default async function CompanyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const { id } = await params;
  const sp = await searchParams;
  const section = sectionOf(sp.section);
  const [c, plans, flash, history] = await Promise.all([
    loadPlatform(() => platformApi.get<CompanyDetail>(`/companies/${id}`)),
    platformApi.get<Plan[]>("/plans"),
    readFlash(id),
    section === "history" ? platformApi.get<CompanyHistory>(`/companies/${id}/history`, sp.kind ? { kind: sp.kind } : undefined) : null,
  ]);
  const today = todayIn(TZ);
  const live = c.status !== "deleted";
  const off = c.status === "off";
  const head = headline(c);
  const saved = sp.saved as SavedCard | undefined;
  const people = c.activity?.people ?? [];
  const active = people.filter((p) => p.active).length;
  const lead = c.leads[0];

  const exportEntry: MenuEntry = { label: "Export (zip of all its data)", href: `/platform/companies/${id}/export`, download: true };
  const more: MenuEntry[] = live
    ? [
        ...(c.status !== "active" ? [{ label: "Switch on…", panel: "status", id: "active" }] : []),
        ...(c.status !== "read_only" ? [{ label: "Make read-only…", panel: "status", id: "read_only" }] : []),
        ...(c.status !== "off" ? [{ label: "Switch off…", panel: "status", id: "off" }] : []),
        ...(c.statusManual ? [{ label: "Back to the automatic rules…", panel: "status", id: "auto" }] : []),
        ...(c.kind !== "client"
          ? [
              {
                label: `End the ${c.kind} now…`,
                confirm: {
                  title: `End the ${c.kind} now?`,
                  body: "It becomes read-only now, then is switched off and deleted by the rules.",
                  confirmLabel: "End it now",
                },
                action: endAction.bind(null, id),
              } as MenuEntry,
            ]
          : []),
        ...(lead ? [{ label: "Open the client inquiry", href: `/platform/leads/${lead.id}` }] : []),
        { label: "Copy the web address", copy: c.address },
        { separator: true } as const,
        { label: "Delete…", panel: "delete", danger: true } as const,
      ]
    : lead
      ? [{ label: "Open the client inquiry", href: `/platform/leads/${lead.id}` }]
      : [];

  const summary = [
    COMPANY_KIND_LABEL[c.kind],
    c.plan ? `${c.plan.name} plan` : "no plan",
    c.kind === "client"
      ? c.renewsOn
        ? `paid until ${date(c.renewsOn)}`
        : "no paid-until date"
      : c.endsAt
        ? `ends ${date(c.endsAt)}`
        : null,
    live ? `${active}${c.plan?.maxUsers ? ` of ${c.plan.maxUsers}` : ""} ${active === 1 && !c.plan?.maxUsers ? "person" : "people"}` : null,
    live ? c.address.replace(/^https?:\/\//, "") : null,
  ].filter(Boolean);

  const counts: Record<string, number | undefined> = {
    people: live ? people.length : undefined,
    billing: c.kind === "client" ? c.payments.length : undefined,
    history: c.logCount,
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        backHref="/platform/companies"
        backLabel="Companies"
        phoneStack
        title={c.name}
        badge={<StatusBadge meaning={head.meaning}>{head.label}</StatusBadge>}
        summary={
          <>
            {summary.join(" · ")}
            {c.previousSlug && <> (was {c.previousSlug})</>}
            {lead && (
              <>
                {" "}
                ·{" "}
                <Link href={`/platform/leads/${lead.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                  from client inquiry {lead.name} →
                </Link>
              </>
            )}
          </>
        }
        papers={
          live && (
            <a href={`/platform/companies/${id}/export`} download className={buttonClass("secondary", "sm")}>
              <Download aria-hidden /> Export
            </a>
          )
        }
        primary={
          live && (
            <form action={openCompanyAction.bind(null, id)}>
              <button
                type="submit"
                className={buttonClass("primary", "sm")}
                disabled={off}
                aria-describedby={off ? "open-reason" : undefined}
                title={off ? "Switch it on to open it" : "Work inside the company (it is logged)"}
              >
                <LogIn aria-hidden /> Open company
              </button>
            </form>
          )
        }
        more={more.length > 0 && <MoreMenu label={`More for ${c.name}`} items={more} phoneItems={live ? [exportEntry] : []} />}
      />

      {off && (
        <Banner meaning="bad">
          <span id="open-reason">
            Switched off{c.statusReason ? ` (${c.statusReason})` : ""}: nobody can sign in, and it cannot be opened. Switch it on from ⋯ to
            open it.
          </span>
        </Banner>
      )}
      {!live && (
        <Banner meaning="info">
          Deleted {c.deletedAt ? date(c.deletedAt) : ""}: its data and files are gone; a copy was kept in storage (see History). Its short
          name stays taken for a while.
        </Banner>
      )}
      {flash && (
        <Alert tone="success">
          {c.kind !== "client" ? "The demo is ready." : "The company is ready."}{" "}
          {flash.link
            ? flash.emailed
              ? "The tenant admin was emailed a link to set a password. You can also send it yourself:"
              : "Email is not set up: send the tenant admin this link to set a password:"
            : "The person signs in with the password they chose."}
          {flash.link && <CopyLink link={flash.link} />}
        </Alert>
      )}

      <SectionList
        label="Company sections"
        boxed
        wide
        items={SECTIONS.map((s) => ({ href: sectionHref(id, s.key), label: s.label, active: s.key === section, count: counts[s.key] }))}
      >
        {section === "overview" && <OverviewSection c={c} today={today} />}
        {section === "people" && <PeopleSection c={c} />}
        {section === "plan" && <PlanSection c={c} modules={companyModulesAction.bind(null, id)} saved={saved} />}
        {section === "billing" && (
          <BillingSection
            c={c}
            today={today}
            saved={saved}
            removePayment={Object.fromEntries(c.payments.map((p) => [p.id, removePaymentAction.bind(null, id, p.id)]))}
          />
        )}
        {section === "details" && <DetailsSection c={c} saved={saved} />}
        {section === "history" && history && <HistorySection c={c} history={history} page={toPage(sp.page)} />}
      </SectionList>

      {live && (
        <CompanyPanels
          c={{
            id: c.id,
            name: c.name,
            slug: c.slug,
            kind: c.kind,
            status: c.status,
            statusManual: c.statusManual,
            plan: c.plan,
            renewsOn: c.renewsOn,
            endsAt: c.endsAt,
            contactName: c.contactName,
            contactEmail: c.contactEmail,
            contactPhone: c.contactPhone ?? null,
            notes: c.notes,
            previousSlug: c.previousSlug,
            address: c.address,
            people: people.map((p) => ({ id: p.id, name: p.name, email: p.email, tenantAdmin: p.tenantAdmin })),
            currency: c.payments[0]?.currency ?? c.plan?.currency ?? "USD",
          }}
          plans={plans}
          today={today}
          actions={{
            update: updateCompanyAction.bind(null, id),
            status: companyStatusAction.bind(null, id),
            extend: extendAction.bind(null, id),
            end: endAction.bind(null, id),
            makeReal: makeRealAction.bind(null, id),
            remove: deleteCompanyAction.bind(null, id),
            adminPassword: adminPasswordAction.bind(null, id),
            payment: paymentAction.bind(null, id),
            modules: companyModulesAction.bind(null, id),
          }}
        />
      )}
    </div>
  );
}
