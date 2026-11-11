import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { PAYMENT_RECORD_LABEL, PAYMENT_STATUS_LABEL, type PaymentList, type PaymentRow } from "@kebo/shared";
import {
  Badge,
  buildHref,
  ButtonLink,
  Card,
  cn,
  DataRow,
  EmptyState,
  ListToolbar,
  PageHeader,
  Pager,
  PhoneList,
  PhoneRow,
  StatusBadge,
  Table,
  Td,
  Th,
  THead,
  toPage,
} from "@kebo/ui";
import { todayIn } from "@kebo/utils";
import { api } from "@/lib/api";
import { date, money, TZ } from "@/lib/format";
import { crumbsFor, labelFor } from "@/lib/nav";
import { requireUser } from "@/lib/session";
import { UUID } from "@/lib/ids";
import { PeriodBar, periodOf } from "@/components/common/period";
import { opensPayments, paymentHref } from "./shared";

export const metadata = { title: "Payments" };

const PAGE_SIZE = 50;
type Search = { p?: string; dir?: string; status?: string; q?: string; order?: string; party?: string; page?: string };

const STATUS_MEANING = { to_verify: "warn", sent_back: "bad", recorded: "ok", void: "neutral" } as const;

/**
 * Treasury › Payments: every payment in and out, in one list. Other pages show a total and link
 * here (?order= or ?party=); each row opens the payment's own page. Recording is one form
 * (Record payment), opened from here and from every "Record payment" button.
 */
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requireUser();
  if (!opensPayments(me)) redirect("/forbidden");
  const sp = await searchParams;
  const today = todayIn(TZ);
  const order = UUID.test(sp.order ?? "") ? sp.order : undefined;
  const party = UUID.test(sp.party ?? "") ? sp.party : undefined;
  // Opened for one order or party: every date, unless a period is chosen.
  const allDates = (order || party) && !sp.p;
  const pr = periodOf(sp.p, today);
  const dir = sp.dir === "in" || sp.dir === "out" || sp.dir === "move" ? sp.dir : undefined;
  const status = sp.status === "to_verify" || sp.status === "void" ? sp.status : undefined;
  const q = sp.q?.trim() || undefined;
  const page = toPage(sp.page);
  const list = await api.get<PaymentList>("/treasury/payments", {
    from: allDates ? undefined : pr.from,
    to: allDates ? undefined : pr.to,
    dir,
    status,
    q,
    order,
    party,
    page,
    pageSize: PAGE_SIZE,
  });
  const keep = { p: sp.p, dir, status, q, order, party };
  const href = (change: Record<string, string | undefined>) => buildHref("/payments", keep, { page: undefined, ...change });
  const scoped = list.rows[0]?.for.find((f) => f.href === `/orders/${order}`)?.label ?? list.rows[0]?.party?.label;
  const recordHref = order ? `/payments/new?kind=in&order=${order}` : "/payments/new";
  const canRecord = Object.values(list.canRecord).some(Boolean);

  return (
    <div>
      <PageHeader
        crumbs={crumbsFor("/payments")}
        title={labelFor("/payments")}
        summary={
          order || party ? (
            <>
              For {scoped ?? "this record"} ·{" "}
              <Link href={buildHref("/payments", {}, {})} className="font-medium text-primary hover:underline">
                All payments
              </Link>
            </>
          ) : (
            "Every payment in and out, in one list."
          )
        }
        primary={
          canRecord ? (
            <ButtonLink href={recordHref} variant="primary" size="sm">
              <Plus aria-hidden /> Record payment
            </ButtonLink>
          ) : undefined
        }
      />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {allDates ? (
          <span className="text-sm text-muted">
            Every date ·{" "}
            <Link href={href({ p: today.slice(0, 7) })} className="font-medium text-primary hover:underline">
              One month
            </Link>
          </span>
        ) : (
          <PeriodBar pr={pr} href={(c) => href(c)} today={today} />
        )}
      </div>
      <ListToolbar
        search={{ placeholder: "Party, order, number or reference", value: q, clearHref: href({ q: undefined }) }}
        keep={keep}
        label="Which payments"
        chips={[
          { key: "all", label: "All", count: list.counts.all, href: href({ dir: undefined, status: undefined }), active: !dir && !status },
          {
            key: "in",
            label: "Money in",
            count: list.counts.in,
            href: href({ dir: "in", status: undefined }),
            active: dir === "in" && !status,
          },
          {
            key: "out",
            label: "Money out",
            count: list.counts.out,
            href: href({ dir: "out", status: undefined }),
            active: dir === "out" && !status,
          },
          ...(list.counts.move
            ? [
                {
                  key: "move",
                  label: "Between our accounts",
                  count: list.counts.move,
                  href: href({ dir: "move", status: undefined }),
                  active: dir === "move" && !status,
                },
              ]
            : []),
          {
            key: "to_verify",
            label: "To verify",
            count: list.counts.to_verify,
            href: href({ dir: undefined, status: "to_verify" }),
            active: status === "to_verify",
          },
          { key: "void", label: "Removed", href: href({ dir: undefined, status: "void" }), active: status === "void" },
        ]}
      />
      <Card className="overflow-clip p-0">
        {list.rows.length === 0 ? (
          <EmptyState
            framed
            title={q ? "No payment matches" : status === "void" ? "Nothing removed" : "No payments"}
            description={allDates ? "Payments recorded for it show here." : `Nothing was paid or received in ${pr.name}.`}
          />
        ) : (
          <>
            <PhoneList label="Payments" className="sm:hidden">
              {list.rows.map((r) => (
                <PhoneRow
                  key={`${r.kind}:${r.id}`}
                  href={paymentHref(r)}
                  muted={r.status === "void"}
                  title={r.what}
                  line={`${date(r.on)}${r.party ? ` · ${r.party.label}` : ""}${r.number ? ` · ${r.number}` : ""}`}
                  status={
                    r.status !== "recorded" && (
                      <StatusBadge meaning={STATUS_MEANING[r.status]}>{PAYMENT_STATUS_LABEL[r.status]}</StatusBadge>
                    )
                  }
                  figure={<Amount r={r} />}
                />
              ))}
            </PhoneList>
            <div className="hidden overflow-x-auto sm:block">
              <Table>
                <THead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Payment</Th>
                    <Th>Party</Th>
                    <Th>For</Th>
                    <Th>Account</Th>
                    <Th className="text-right">In</Th>
                    <Th className="text-right">Out</Th>
                    <Th>
                      <span className="sr-only">Status</span>
                    </Th>
                  </tr>
                </THead>
                <tbody>
                  {list.rows.map((r) => (
                    <DataRow
                      key={`${r.kind}:${r.id}`}
                      href={paymentHref(r)}
                      className={cn("align-top", r.status === "void" && "text-muted line-through")}
                    >
                      <Td className="text-sm whitespace-nowrap">{date(r.on)}</Td>
                      <Td className="min-w-56">
                        <Link href={paymentHref(r)} className="text-sm font-medium hover:text-primary">
                          {r.what}
                        </Link>
                        <span className="block text-xs text-muted">
                          {PAYMENT_RECORD_LABEL[r.kind]}
                          {r.number && ` · ${r.number}`}
                          {r.reference && ` · ref. ${r.reference}`}
                        </span>
                      </Td>
                      <Td className="text-sm">
                        {r.party ? (
                          r.party.href ? (
                            <Link href={r.party.href} className="hover:text-primary">
                              {r.party.label}
                            </Link>
                          ) : (
                            r.party.label
                          )
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </Td>
                      <Td className="text-sm whitespace-nowrap">
                        {r.for.length ? (
                          r.for.map((f, i) => (
                            <span key={f.label}>
                              {i > 0 && ", "}
                              {f.href ? (
                                <Link href={f.href} className="hover:text-primary">
                                  {f.label}
                                </Link>
                              ) : (
                                f.label
                              )}
                            </span>
                          ))
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </Td>
                      <Td className="text-sm">{r.account ?? <span className="text-muted">—</span>}</Td>
                      <Td className="text-right text-sm whitespace-nowrap tabular text-ok">
                        {r.direction === "in" ? money(r.amount, r.currency) : ""}
                      </Td>
                      <Td className="text-right text-sm whitespace-nowrap tabular">
                        {r.direction !== "in" ? money(r.amount, r.currency) : ""}
                      </Td>
                      <Td>
                        {/* Only what needs a look: a recorded payment has no badge. */}
                        {r.status !== "recorded" && (
                          <StatusBadge meaning={STATUS_MEANING[r.status]}>{PAYMENT_STATUS_LABEL[r.status]}</StatusBadge>
                        )}
                        {r.fromCredit && <Badge className="ml-1">From credit</Badge>}
                      </Td>
                    </DataRow>
                  ))}
                </tbody>
              </Table>
            </div>
          </>
        )}
        <Pager base="/payments" params={keep} page={page} pageSize={PAGE_SIZE} total={list.total} />
      </Card>
    </div>
  );
}

function Amount({ r }: { r: PaymentRow }) {
  return (
    <span className={cn("tabular", r.direction === "in" && "text-ok")}>
      {r.direction === "in" ? "+ " : r.direction === "out" ? "− " : ""}
      {money(r.amount, r.currency)}
    </span>
  );
}
