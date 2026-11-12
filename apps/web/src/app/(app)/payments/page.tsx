import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Banknote, Check, Download, List, Plus, TriangleAlert } from "lucide-react";
import { can, PAYMENT_STATUS_LABEL, type PaymentList, type PaymentRow, type PaymentSum } from "@kebo/shared";
import {
  Badge,
  buildHref,
  ButtonLink,
  Card,
  cn,
  DataRow,
  EmptyState,
  LinkTabs,
  PageHeader,
  Pager,
  PhoneList,
  PhoneRow,
  RefCode,
  Segmented,
  StatRow,
  StatTile,
  StatusBadge,
  Table,
  Td,
  Th,
  THead,
  toPage,
} from "@kebo/ui";
import { addDays, todayIn } from "@kebo/utils";
import { api } from "@/lib/api";
import { date, money, TZ, whole } from "@/lib/format";
import { crumbsFor } from "@/lib/nav";
import { requireUser } from "@/lib/session";
import { UUID } from "@/lib/ids";
import { FilterCard } from "@/components/common/filter-card";
import { periodOf } from "@/components/common/period";
import { RequestsTab } from "./requests-tab";
import { opensPayments, paymentHref } from "./shared";

export const metadata = { title: "Payments" };

const PAGE_SIZE = 50;
type Search = { tab?: string; mine?: string; p?: string; dir?: string; status?: string; kind?: string; q?: string; order?: string; party?: string; account?: string; method?: string; page?: string };
/** A link that filters the list of payments (an order's, a party's, a search) opens the Paid tab. */
const LIST_FILTERS = ["p", "dir", "kind", "order", "party", "account", "method"] as const;

const STATUS_MEANING = { to_verify: "warn", sent_back: "bad", recorded: "ok", void: "neutral" } as const;
const MONTH = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

/** The largest of a list's totals ("USD 99,740"), and how many other currencies there are. */
function top(sums: PaymentSum[]) {
  const first = sums[0];
  return first ? `${whole(first.amount, first.currency)}${sums.length > 1 ? ` +${sums.length - 1}` : ""}` : "—";
}

/** The row's status as the board shows it: a recorded receipt reads "Verified", a supplier payment "Paid", an expense "Expense", a transfer "Transfer". */
function statusOf(r: PaymentRow) {
  if (r.status !== "recorded") return <StatusBadge meaning={STATUS_MEANING[r.status]}>{PAYMENT_STATUS_LABEL[r.status]}</StatusBadge>;
  if (r.fromCredit) return <Badge>From credit</Badge>;
  if (r.kind === "expense") return <StatusBadge meaning="neutral">Expense</StatusBadge>;
  if (r.kind === "transfer") return <Badge dot className="bg-chart-4/12 text-chart-4">Transfer</Badge>;
  if (r.direction === "in") return <StatusBadge meaning="ok">Verified</StatusBadge>;
  return <StatusBadge meaning="ok">Paid</StatusBadge>;
}

/**
 * Treasury › Payments: what is asked for and what was paid, in one place. Two tabs: Payment requests (every
 * part of an order's plan still being asked for; open to everyone who sees orders) and Paid (every payment
 * recorded, with its receipt; for the people who see money).
 */
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const seesMoney = opensPayments(me);
  const tab: "requests" | "paid" =
    !seesMoney || sp.tab === "requests"
      ? "requests"
      : sp.tab === "paid" || sp.status === "to_verify" || sp.status === "void" || LIST_FILTERS.some((k) => sp[k])
        ? "paid"
        : "requests";
  if (tab === "requests") {
    return (
      <div>
        <PageHeader
          crumbs={crumbsFor("/payments")}
          title="Payments"
          summary="What is asked for and what was paid, in one place"
          primary={
            can(me, "payments.record") ? (
              <ButtonLink href="/payments/new?kind=in" variant="primary">
                <Plus aria-hidden /> Record payment
              </ButtonLink>
            ) : undefined
          }
        />
        {seesMoney && <Tabs tab="requests" />}
        <RequestsTab sp={sp} />
      </div>
    );
  }
  if (!seesMoney) redirect("/forbidden");
  const today = todayIn(TZ);
  const order = UUID.test(sp.order ?? "") ? sp.order : undefined;
  const party = UUID.test(sp.party ?? "") ? sp.party : undefined;
  const account = UUID.test(sp.account ?? "") ? sp.account : undefined;
  // Opened for one order or party: every date, unless a period is chosen.
  const allDates = (order || party) && !sp.p;
  const pr = periodOf(sp.p, today);
  const dir = sp.dir === "in" || sp.dir === "out" || sp.dir === "move" ? sp.dir : undefined;
  const status = sp.status === "to_verify" || sp.status === "void" ? sp.status : undefined;
  const kind = sp.kind === "expense" ? sp.kind : undefined;
  const q = sp.q?.trim() || undefined;
  const method = sp.method?.trim() || undefined;
  const page = toPage(sp.page);
  const list = await api.get<PaymentList>("/treasury/payments", {
    from: allDates ? undefined : pr.from,
    to: allDates ? undefined : pr.to,
    dir,
    status,
    kind,
    q,
    order,
    party,
    account,
    method,
    page,
    pageSize: PAGE_SIZE,
  });
  const keep = { tab: "paid", p: sp.p, dir, status, kind, q, order, party, account, method };
  const href = (change: Record<string, string | undefined>) => buildHref("/payments", keep, { page: undefined, ...change });
  const chip = (c: Record<string, string | undefined>) => href({ dir: undefined, status: undefined, kind: undefined, ...c });
  const recordHref = order ? `/payments/new?kind=in&order=${order}` : "/payments/new";
  const canRecord = Object.values(list.canRecord).some(Boolean);
  const t = list.totals;
  const when = allDates ? "" : pr.period === pr.thisMonth ? " this month" : ` · ${pr.name}`;
  // The month filter: this month, the eleven before it, this year and last year.
  const months = Array.from({ length: 12 }, (_, i) => addDays(`${pr.thisMonth}-15`, -30 * i).slice(0, 7)).filter((m, i, all) => all.indexOf(m) === i);
  const periods = [
    ...months.map((m) => ({ value: m, label: MONTH.format(new Date(`${m}-01T00:00:00Z`)).replace(` ${today.slice(0, 4)}`, "") })),
    { value: today.slice(0, 4), label: `All of ${today.slice(0, 4)}` },
    { value: String(Number(today.slice(0, 4)) - 1), label: `All of ${Number(today.slice(0, 4)) - 1}` },
  ];

  return (
    <div>
      <PageHeader
        crumbs={crumbsFor("/payments")}
        title="Payments"
        summary={
          order || party ? (
            <>
              For {list.scope ?? "this record"} ·{" "}
              <Link href={buildHref("/payments", {}, { tab: "paid" })} className="font-medium text-primary hover:underline">
                All payments
              </Link>
            </>
          ) : (
            "What is asked for and what was paid, in one place"
          )
        }
        actions={
          <ButtonLink href={buildHref("/sheets/export/cash-book", {}, { format: "csv", from: allDates ? undefined : pr.from, to: allDates ? undefined : pr.to, account })} variant="secondary">
            <Download aria-hidden /> Export CSV
          </ButtonLink>
        }
        primary={
          canRecord ? (
            <ButtonLink href={recordHref} variant="primary">
              <Plus aria-hidden /> Record payment
            </ButtonLink>
          ) : undefined
        }
      />
      {!order && !party && <Tabs tab="paid" />}
      <StatRow className="mb-4">
        <StatTile icon={ArrowDownToLine} iconColor={1} label={`In${when}`} value={top(t.in)} sub={`${t.inCount} receipt${t.inCount === 1 ? "" : "s"}`} />
        <StatTile icon={ArrowUpFromLine} iconColor={2} label={`Out${when}`} value={top(t.out)} sub={`${t.outCount} payment${t.outCount === 1 ? "" : "s"} out`} />
        <StatTile
          icon={Check}
          iconColor={2}
          label="To verify"
          value={list.counts.to_verify}
          sub={t.toVerify.length ? top(t.toVerify) : "nothing waiting"}
          tone={list.counts.to_verify ? "warn" : undefined}
          href={list.counts.to_verify ? chip({ status: "to_verify" }) : undefined}
        />
        <StatTile icon={Banknote} iconColor={4} label="Expenses" value={top(t.expenses)} sub={`${list.counts.expense} entr${list.counts.expense === 1 ? "y" : "ies"}`} />
      </StatRow>
      <LinkTabs
        label="Which payments"
        className="mb-4"
        tabs={[
          { href: chip({}), label: <><List aria-hidden /> All</>, active: !dir && !status && !kind },
          { href: chip({ dir: "in" }), label: <><ArrowDownToLine aria-hidden /> Money in</>, active: dir === "in" && !status },
          { href: chip({ dir: "out" }), label: <><ArrowUpFromLine aria-hidden /> Money out</>, active: dir === "out" && !status && !kind },
          { href: chip({ kind: "expense" }), label: <><Banknote aria-hidden /> Expenses</>, active: kind === "expense" },
          { href: chip({ dir: "move" }), label: <><ArrowLeftRight aria-hidden /> Transfers</>, active: dir === "move" },
          { href: chip({ status: "to_verify" }), label: <><TriangleAlert aria-hidden /> To verify</>, count: list.counts.to_verify, active: status === "to_verify" },
          { href: chip({ status: "void" }), label: "Removed", active: status === "void" },
        ]}
      />
      <FilterCard
        search="Search number, customer, reference…"
        value={q}
        keep={{ tab: "paid", dir, status, kind, order, party }}
        clearHref={href({ q: undefined })}
        selects={[
          { name: "account", label: "Account", value: account, options: list.accounts.map((a) => ({ value: a.id, label: a.name })) },
          { name: "method", label: "Method", value: method, options: list.methods.map((m) => ({ value: m, label: m })) },
          { name: "p", label: "Month", value: sp.p && sp.p !== pr.thisMonth ? pr.period : undefined, options: periods.slice(1), all: allDates ? "Every date" : periods[0]!.label },
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
                  title={r.party?.label ?? r.what}
                  line={`${r.number ? `${r.number} · ` : ""}${date(r.on)}${r.party ? ` · ${r.what}` : ""}`}
                  status={statusOf(r)}
                  figure={<Amount r={r} />}
                />
              ))}
            </PhoneList>
            <div className="hidden overflow-x-auto sm:block">
              <Table>
                <THead>
                  <tr>
                    <Th>Number</Th>
                    <Th>Date</Th>
                    <Th>Who · for</Th>
                    <Th>Method</Th>
                    <Th>Account</Th>
                    <Th className="text-right">Amount</Th>
                    <Th>By</Th>
                    <Th>Status</Th>
                  </tr>
                </THead>
                <tbody>
                  {list.rows.map((r) => (
                    <DataRow key={`${r.kind}:${r.id}`} href={paymentHref(r)} className={cn(r.status === "void" && "text-muted line-through")}>
                      <Td className="whitespace-nowrap">{r.number ? <RefCode>{r.number}</RefCode> : <span className="text-muted">—</span>}</Td>
                      <Td className="text-sm whitespace-nowrap">{date(r.on)}</Td>
                      <Td className="min-w-64">
                        <Link href={paymentHref(r)} className="text-sm font-semibold hover:text-primary">
                          {r.party?.label ?? r.what}
                        </Link>
                        <span className="block text-xs text-text-2">
                          {[r.for.map((f) => f.label).join(", "), r.party ? r.what : null, r.reference ? `ref. ${r.reference}` : null].filter(Boolean).join(" · ")}
                        </span>
                      </Td>
                      <Td className="text-sm whitespace-nowrap">{r.method ?? <span className="text-muted">—</span>}</Td>
                      <Td className="text-sm">{r.account ?? <span className="text-muted">—</span>}</Td>
                      <Td className="text-right text-sm whitespace-nowrap">
                        <Amount r={r} />
                      </Td>
                      <Td className="text-sm">{r.by ?? <span className="text-muted">—</span>}</Td>
                      <Td>{statusOf(r)}</Td>
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

/** The page's two tabs. */
function Tabs({ tab }: { tab: "requests" | "paid" }) {
  return (
    <Segmented
      label="Show"
      className="mb-4"
      options={[
        { href: "/payments?tab=requests", label: "Payment requests", active: tab === "requests" },
        { href: "/payments?tab=paid", label: "Paid", active: tab === "paid" },
      ]}
    />
  );
}

function Amount({ r }: { r: PaymentRow }) {
  return (
    <span className="tabular">
      {r.direction === "out" ? "– " : ""}
      {money(r.amount, r.currency)}
    </span>
  );
}
