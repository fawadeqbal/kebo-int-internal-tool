import Link from "next/link";
import { Download, LogIn } from "lucide-react";
import { LIFECYCLE } from "@kebo/shared";
import { Alert, Badge, buttonClass, Card, CardBody, CardHeader, DetailList, PageHeader, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { todayIn } from "@kebo/utils";
import { platformApi } from "@/lib/api";
import { loadPlatform, readFlash } from "@/lib/platform";
import { date, dateTime, money, timeAgo } from "@/lib/format";
import type { CompanyDetail, Plan } from "@/lib/types-platform";
import { BillingBadge, CompanyStatusBadge, KindBadge, LeadStatusBadge } from "@/components/platform/badges";
import {
  adminPasswordAction,
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
import { ActionButton, AdminPasswordForm, CopyLink, DeleteForm, DetailsForm, ExtendForm, MakeRealForm, PaymentForm, StatusForm } from "./forms";

export const metadata = { title: "Company" };

const TZ = process.env.APP_TIME_ZONE ?? process.env.NEXT_PUBLIC_APP_TIME_ZONE ?? "Asia/Shanghai";

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [c, plans, flash] = await Promise.all([
    loadPlatform(() => platformApi.get<CompanyDetail>(`/companies/${id}`)),
    platformApi.get<Plan[]>("/plans"),
    readFlash(id),
  ]);
  const live = c.status !== "deleted";
  const trial = c.kind !== "client";
  const admins = c.activity?.people.filter((p) => p.tenantAdmin) ?? [];
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {c.name} <KindBadge kind={c.kind} /> <CompanyStatusBadge status={c.status} />
            {c.kind === "client" && live && c.billing !== "active" && <BillingBadge billing={c.billing} />}
          </span>
        }
        description={
          <>
            <span className="font-mono">{c.slug}</span>
            {c.previousSlug && <> (was {c.previousSlug})</>} · since {date(c.startsOn)} · {c.plan ? `plan ${c.plan.name}` : "no plan"}
            {c.statusReason && <> · {c.statusReason}</>}
          </>
        }
        actions={
          live && (
            <>
              <a href={`/platform/companies/${id}/export`} className={buttonClass("secondary", "sm")}>
                <Download aria-hidden /> Export
              </a>
              <form action={openCompanyAction.bind(null, id)}>
                <button
                  type="submit"
                  className={buttonClass("primary", "sm")}
                  disabled={c.status === "off"}
                  title={c.status === "off" ? "Switch it on to open it" : "Work inside the company (logged)"}
                >
                  <LogIn aria-hidden /> Open company
                </button>
              </form>
            </>
          )
        }
      />

      {flash && (
        <Alert tone="success">
          {trial ? "The demo is ready." : "The company is ready."}{" "}
          {flash.link
            ? flash.emailed
              ? "The tenant admin was emailed a link to set a password. You can also send it yourself:"
              : "Email is not set up: send the tenant admin this link to set a password:"
            : "The person signs in with the password they chose."}
          {flash.link && <CopyLink link={flash.link} />}
        </Alert>
      )}
      {c.warnings.map((w) => (
        <Alert key={w} tone="warning">
          {w}
        </Alert>
      ))}

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="flex min-w-0 flex-col gap-5">
          {c.activity && (
            <Card>
              <CardHeader title="Activity" description="What is happening in the company (your own visits do not count)" />
              <CardBody>
                <DetailList
                  columns={3}
                  items={[
                    { label: "People", value: `${c.usage?.users ?? 0}${c.plan?.maxUsers ? ` of ${c.plan.maxUsers}` : ""}` },
                    {
                      label: "Files",
                      value: `${c.usage?.storageMb ?? 0} MB${c.plan?.maxStorageMb ? ` of ${c.plan.maxStorageMb} MB` : ""}`,
                    },
                    { label: "Last active", value: c.lastActiveAt ? timeAgo(c.lastActiveAt) : "Never" },
                    { label: "Sign-ins, 30 days", value: c.activity.signInsLast30Days },
                    { label: "Inquiries", value: `${c.activity.inquiries} (${c.activity.inquiriesLast30Days} in 30 days)` },
                    { label: "Orders", value: c.activity.orders },
                  ]}
                />
              </CardBody>
              <Table>
                <THead>
                  <tr>
                    <Th>Person</Th>
                    <Th>Role</Th>
                    <Th className="text-right">Last signed in</Th>
                  </tr>
                </THead>
                <tbody>
                  {c.activity.people.map((p) => (
                    <Tr key={p.id} className={p.active ? "" : "text-muted"}>
                      <Td>
                        <span className="block font-medium">{p.name}</span>
                        <span className="block text-xs text-muted">{p.email}</span>
                      </Td>
                      <Td>
                        {p.role}
                        {p.tenantAdmin && (
                          <Badge tone="primary" className="ml-1.5">
                            Tenant admin
                          </Badge>
                        )}
                        {!p.active && <span className="ml-1.5 text-xs">(off)</span>}
                      </Td>
                      <Td className="text-right text-xs whitespace-nowrap text-muted">
                        {p.lastLoginAt ? timeAgo(p.lastLoginAt) : "Never"}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              {admins.length > 0 && (
                <CardBody className="border-t border-line">
                  <p className="mb-2 text-sm text-text-2">
                    Tenant admin locked out? Send a link to set a new password (it is emailed, and shown here).
                  </p>
                  <AdminPasswordForm action={adminPasswordAction.bind(null, id)} admins={admins} />
                </CardBody>
              )}
            </Card>
          )}

          {live && (
            <Card>
              <CardHeader title="Details" />
              <CardBody>
                <DetailsForm c={c} plans={plans} action={updateCompanyAction.bind(null, id)} />
              </CardBody>
            </Card>
          )}

          {c.kind === "client" && live && (
            <Card>
              <CardHeader
                title="Payments"
                description={c.renewsOn ? `Paid until ${date(c.renewsOn)}` : "Record each payment; it sets the paid-until date."}
              />
              {c.payments.length > 0 && (
                <Table>
                  <THead>
                    <tr>
                      <Th>Paid on</Th>
                      <Th className="text-right">Amount</Th>
                      <Th>Paid until</Th>
                      <Th>Note</Th>
                      <Th className="relative">
                        <span className="sr-only">Remove</span>
                      </Th>
                    </tr>
                  </THead>
                  <tbody>
                    {c.payments.map((p) => (
                      <Tr key={p.id}>
                        <Td className="whitespace-nowrap">{date(p.paidOn)}</Td>
                        <Td className="text-right tabular">{money(p.amountMinor / 100, p.currency)}</Td>
                        <Td className="whitespace-nowrap">{date(p.paidUntil)}</Td>
                        <Td className="text-sm text-text-2">{p.note}</Td>
                        <Td className="text-right">
                          <ActionButton
                            action={removePaymentAction.bind(null, id, p.id)}
                            label="Remove"
                            variant="ghost"
                            confirm="Remove this payment? The paid-until date stays as it is."
                          />
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
              <CardBody className="border-t border-line">
                <PaymentForm action={paymentAction.bind(null, id)} today={todayIn(TZ)} currency={c.payments[0]?.currency ?? "USD"} />
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="History" description="Everything done to this company from the platform" />
            <ul className="divide-y divide-line">
              {c.log.map((e) => (
                <li key={e.id} className="px-4 py-2 text-sm">
                  <p>{e.summary}</p>
                  <p className="text-xs text-muted">
                    {e.adminName ?? "Automatic"} · {dateTime(e.at)}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          {live && (
            <Card>
              <CardHeader
                title="Switch on or off"
                description={c.statusManual ? "Set by hand: the automatic rules leave it alone." : "Follows the automatic rules."}
              />
              <CardBody>
                <StatusForm action={companyStatusAction.bind(null, id)} status={c.status} manual={c.statusManual} name={c.name} />
              </CardBody>
            </Card>
          )}

          {trial && live && (
            <Card>
              <CardHeader title={c.kind === "demo" ? "Demo" : "Trial"} description={c.endsAt ? `Ends ${dateTime(c.endsAt)}` : undefined} />
              <CardBody className="flex flex-col gap-4">
                <ExtendForm action={extendAction.bind(null, id)} />
                <ActionButton
                  action={endAction.bind(null, id)}
                  label="End it now"
                  confirm="End it now? It becomes read-only, then is switched off and deleted by the rules."
                />
                <p className="text-xs text-muted">
                  After it ends: read-only for {LIFECYCLE.readOnlyDays} days, then off, then deleted after {LIFECYCLE.deleteAfterOffDays}{" "}
                  more days. Their contact gets an email a day before the end.
                </p>
                <div className="border-t border-line pt-4">
                  <p className="mb-2 text-sm font-medium">Make it real</p>
                  <MakeRealForm action={makeRealAction.bind(null, id)} plans={plans} />
                </div>
              </CardBody>
            </Card>
          )}

          {c.leads.length > 0 && (
            <Card>
              <CardHeader title="Client inquiry" />
              <ul className="divide-y divide-line">
                {c.leads.map((l) => (
                  <li key={l.id}>
                    <Link href={`/platform/leads/${l.id}`} className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-surface-2/60">
                      <span className="flex-1">{l.name}</span>
                      <LeadStatusBadge status={l.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {live && (
            <Card className="border-bad/30">
              <CardHeader title="Delete" />
              <CardBody>
                <DeleteForm action={deleteCompanyAction.bind(null, id)} slug={c.slug} />
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
