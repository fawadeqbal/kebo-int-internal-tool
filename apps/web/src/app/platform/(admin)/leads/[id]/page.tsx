import Link from "next/link";
import { LEAD_SOURCE_LABEL, suggestSlug } from "@kebo/shared";
import { Card, CardBody, CardHeader, DetailList, PageHeader } from "@kebo/ui";
import { platformApi } from "@/lib/api";
import { loadPlatform } from "@/lib/platform";
import { dateTime, timeAgo } from "@/lib/format";
import type { LeadDetail, Plan } from "@/lib/types-platform";
import { CompanyStatusBadge, KindBadge, LeadStatusBadge } from "@/components/platform/badges";
import { ActionButton } from "../../companies/[id]/forms";
import { deleteLeadAction, giveDemoAction, leadNoteAction, updateLeadAction } from "@/app/platform/actions";
import { GiveDemoForm, LeadStatusForm, NoteForm } from "./forms";

export const metadata = { title: "Client inquiry" };

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [l, plans] = await Promise.all([
    loadPlatform(() => platformApi.get<LeadDetail>(`/leads/${id}`)),
    platformApi.get<Plan[]>("/plans"),
  ]);
  const hasCompany = l.company && l.company.status !== "deleted";
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {l.companyName} <LeadStatusBadge status={l.status} />
          </span>
        }
        description={`${LEAD_SOURCE_LABEL[l.source]} · ${timeAgo(l.createdAt)}`}
        backHref="/platform/leads"
        backLabel="Client inquiries"
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader title="Who" />
            <CardBody className="flex flex-col gap-4">
              <DetailList
                items={[
                  { label: "Name", value: l.name },
                  {
                    label: "Email",
                    value: (
                      <a href={`mailto:${l.email}`} className="text-primary hover:underline">
                        {l.email}
                      </a>
                    ),
                  },
                  { label: "Phone / WhatsApp", value: l.phone },
                  { label: "Country", value: l.country },
                  { label: "Team size", value: l.teamSize },
                  { label: "Came in", value: dateTime(l.createdAt) },
                ]}
              />
              {l.message && <p className="rounded-lg bg-surface-2 p-3 text-sm whitespace-pre-wrap">{l.message}</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Notes" />
            <CardBody className="flex flex-col gap-4">
              <NoteForm action={leadNoteAction.bind(null, id)} />
              {l.notes.length > 0 && (
                <ul className="flex flex-col gap-3">
                  {l.notes.map((n) => (
                    <li key={n.id} className="rounded-lg border border-line p-3 text-sm">
                      <p className="whitespace-pre-wrap">{n.text}</p>
                      <p className="mt-1 text-xs text-muted">
                        {n.byName ?? "—"} · {dateTime(n.createdAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          {l.log.length > 0 && (
            <Card>
              <CardHeader title="History" />
              <ul className="divide-y divide-line">
                {l.log.map((e) => (
                  <li key={e.id} className="px-4 py-2 text-sm">
                    <p>{e.summary}</p>
                    <p className="text-xs text-muted">
                      {e.adminName ?? "Automatic"} · {dateTime(e.at)}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Status" />
            <CardBody>
              <LeadStatusForm
                action={updateLeadAction.bind(null, id)}
                status={l.status}
                lostReason={l.lostReason}
                followUpOn={l.followUpOn}
              />
            </CardBody>
          </Card>
          {hasCompany && l.company ? (
            <Card>
              <CardHeader title={l.company.kind === "client" ? "Their company" : "Their demo"} />
              <CardBody>
                <Link
                  href={`/platform/companies/${l.company.id}`}
                  className="flex flex-wrap items-center gap-2 text-sm font-medium hover:text-primary"
                >
                  {l.company.name} <KindBadge kind={l.company.kind} /> <CompanyStatusBadge status={l.company.status} />
                </Link>
                {l.company.endsAt && l.company.kind !== "client" && (
                  <p className="mt-1 text-xs text-muted">Ends {dateTime(l.company.endsAt)}</p>
                )}
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardHeader title="Give a demo" description="Their own space with sample data; they get an email to set a password." />
              <CardBody className="flex flex-col gap-3">
                <GiveDemoForm
                  action={giveDemoAction.bind(null, id)}
                  plans={plans}
                  suggested={`${suggestSlug(l.companyName).slice(0, 25)}-demo`}
                />
                <Link href={`/platform/companies/new?lead=${id}&kind=client`} className="text-sm font-medium text-primary hover:underline">
                  Or make them a company (a client) straight away
                </Link>
              </CardBody>
            </Card>
          )}
          <Card>
            <CardBody>
              <ActionButton
                action={deleteLeadAction.bind(null, id)}
                label="Delete this inquiry"
                variant="ghost"
                confirm="Delete this client inquiry and its notes?"
              />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
