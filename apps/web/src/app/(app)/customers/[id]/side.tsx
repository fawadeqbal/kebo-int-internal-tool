import Link from "next/link";
import { can } from "@kebo/shared";
import { Avatar, ButtonLink, Card, CardBody, CardHeader, cn, EmptyLine } from "@kebo/ui";
import { ArrowRight, FileText } from "lucide-react";
import { customerOf, customerPaymentsOf, partyNotesOf } from "@/lib/party-data";
import { timeAgo, whole, companyToday } from "@/lib/format";
import { QuickNote } from "@/components/notes/note-forms";
import { addNoteAction } from "../../follow-ups/actions";
import { late } from "./shared";
import { hasFeature, requireUser } from "@/lib/session";
import { api } from "@/lib/api";
import type { CustomerAccount } from "@/lib/types-money";

const waLink = (n: string) => `https://wa.me/${n.replace(/\D/g, "")}`;

/**
 * The customer's side panel, the same on every tab (live audit 20 Nov: inquiries and orders keep theirs; a customer
 * kept it on Overview only): Money, the main contact and Activity with a quick note.
 */
export async function CustomerSide({ id }: { id: string }) {
  const me = await requireUser();
  const seesCosts = can(me, "expenses.manage") && (await hasFeature("expenses"));
  const [c, pay, notes, account] = await Promise.all([
    customerOf(id),
    customerPaymentsOf(id),
    partyNotesOf("customers", id),
    seesCosts ? api.get<CustomerAccount>(`/customers/${id}/account`).catch(() => null) : null,
  ]);
  const totals = pay?.totals ?? [];
  const primary = c.contacts.find((p) => p.isPrimary) ?? c.contacts[0] ?? null;
  const today = companyToday();
  const canNote = can(me, "customers.manage");
  return (
    <>
          {/* Money (board): sold, received, they owe, credit, per currency. */}
          <Card>
            <CardHeader
              title="Money"
              actions={
                <ButtonLink href={`/customers/${c.id}/money`} variant="link" size="sm">
                  <FileText aria-hidden /> Statement
                </ButtonLink>
              }
            />
            <CardBody className="flex flex-col gap-2.5 text-md">
              {totals.length ? (
                totals.map((t) => {
                  const lateAmount = (pay?.orders ?? [])
                    .filter((o) => o.currency === t.currency && late(o, today))
                    .reduce((sum, o) => sum + Number(o.next?.open ?? 0), 0);
                  const credit = pay?.credit.balances.find((b) => b.currency === t.currency)?.amount ?? 0;
                  return (
                    <div key={t.currency} className="flex flex-col gap-2.5">
                      {[
                        [`Sold (${t.orders} order${t.orders === 1 ? "" : "s"})`, whole(t.total, t.currency)],
                        ["Received", whole(t.received, t.currency)],
                        ["They owe", whole(t.due, t.currency)],
                        ["Late", whole(lateAmount, t.currency)],
                        ["Credit on account", whole(credit, t.currency)],
                      ].map(([label, value]) => (
                        <div key={label} className="flex justify-between gap-3">
                          <span className="text-text-2">{label}</span>
                          <strong className={cn("tabular", label === "Late" && lateAmount > 0.005 && "text-bad")}>{value}</strong>
                        </div>
                      ))}
                    </div>
                  );
                })
              ) : (
                <EmptyLine>No orders yet.</EmptyLine>
              )}
              {account && (Number(account.totals.spent) > 0 || Number(account.totals.sales) > 0) && (
                <div className="flex flex-col gap-2.5 border-t border-line pt-2.5">
                  <div className="flex justify-between gap-3">
                    <span className="text-text-2">Spent on them</span>
                    <strong className="tabular">{whole(account.totals.spent, account.currency)}</strong>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-text-2">Profit after all costs</span>
                    <strong className={cn("tabular", Number(account.totals.net) < 0 && "text-bad")}>
                      {whole(account.totals.net, account.currency)}
                      {Number(account.totals.sales) > 0 && (
                        <span className="font-normal text-text-2"> · {((Number(account.totals.net) / Number(account.totals.sales)) * 100).toFixed(1)}%</span>
                      )}
                    </strong>
                  </div>
                  <Link href={`/customers/${c.id}/money#where`} className="w-fit font-medium text-primary hover:underline">
                    Where their money went →
                  </Link>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Main contact (board). */}
          <Card>
            <CardHeader
              title="Main contact"
              actions={
                <ButtonLink href={`/customers/${c.id}/contacts`} variant="link" size="sm">
                  <ArrowRight aria-hidden /> All {c.contacts.length}
                </ButtonLink>
              }
            />
            <CardBody className="flex flex-col gap-1 text-sm">
              {primary ? (
                <>
                  <strong>{primary.name}</strong>
                  {(primary.position || primary.isPrimary) && (
                    <span className="text-text-2">
                      {[primary.position, primary.isPrimary ? "primary" : null].filter(Boolean).join(" · ")}
                    </span>
                  )}
                  {primary.email && (
                    <a href={`mailto:${primary.email}`} className="break-all hover:text-primary">
                      {primary.email}
                    </a>
                  )}
                  {primary.phone && primary.phone === primary.whatsapp ? (
                    <a href={waLink(primary.whatsapp)} target="_blank" rel="noreferrer" className="hover:text-primary">
                      {primary.phone} · WhatsApp
                    </a>
                  ) : (
                    <>
                      {primary.phone && <a href={`tel:${primary.phone}`}>{primary.phone}</a>}
                      {primary.whatsapp && (
                        <a href={waLink(primary.whatsapp)} target="_blank" rel="noreferrer" className="hover:text-primary">
                          {primary.whatsapp} · WhatsApp
                        </a>
                      )}
                    </>
                  )}
                  {primary.wechat && <span>WeChat {primary.wechat}</span>}
                </>
              ) : (
                <span className="text-muted">No contact yet.</span>
              )}
            </CardBody>
          </Card>

          {/* Activity (board): a quick note, then the latest notes and calls. */}
          <Card>
            <CardHeader title="Activity" />
            <CardBody className="flex flex-col gap-3">
              {canNote && <QuickNote action={addNoteAction.bind(null, { key: "customerId", id: c.id })} />}
              {notes.length ? (
                <ol className="flex flex-col gap-3">
                  {notes.slice(0, 5).map((n) => (
                    <li key={n.id} className="flex gap-2.5">
                      <Avatar name={n.author.name} size={30} />
                      <span className="min-w-0 text-md">
                        <span className="line-clamp-2">{n.body}</span>
                        <span className="block text-xs text-muted">
                          {n.author.name} · {timeAgo(n.at)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <EmptyLine>Nothing yet. Notes, calls and meetings show here.</EmptyLine>
              )}
            </CardBody>
          </Card>
    </>
  );
}
