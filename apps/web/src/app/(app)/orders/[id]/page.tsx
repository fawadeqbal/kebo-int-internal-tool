import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";
import { can, STEP_PATH, type FlowStep } from "@kebo/shared";
import { buttonClass, Card, CardBody, CardHeader, cn } from "@kebo/ui";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { orderFlowOf, orderHistoryOf, orderMoneyOf, orderOf, orderStepsOf } from "@/lib/order-data";
import { date, dateTime, money } from "@/lib/format";
import type { DealDetail } from "@/lib/types";
import type { StepView } from "@/lib/types-checklist";
import { optional } from "@/components/print/data";
import { today } from "@/components/orders/today";
import { ProgressBar, readable, StateBadge, StepChanges } from "@/components/orders/step-page";
import { NoteForm } from "../../inquiries/[id]/panels";
import { detailsAction, orderNoteAction } from "../actions";
import { DetailsForm } from "./forms";
import { incotermOf, termsOf } from "./shared";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const o = await orderOf(id);
  return { title: `Order ${o.refNo}` };
}

/** Label left, value right: one line of a card. */
function Line({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <dt className="shrink-0 text-xs text-muted">{label}</dt>
      <dd className={cn("min-w-0 text-right font-medium tabular", tone)}>{value ?? <span className="text-muted">—</span>}</dd>
    </div>
  );
}

/** One step at a glance: state, progress, where it stands, two numbers, and its next item. */
function StepCard({ s, href, facts }: { s: StepView; href: string; facts: { label: string; value: ReactNode }[] }) {
  const focus = s.state === "now" || s.state === "late";
  return (
    <Link
      href={href}
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-surface p-4 shadow-card transition-colors hover:border-line-strong",
        s.state === "late"
          ? "border-bad/60 ring-1 ring-bad/30"
          : s.state === "now"
            ? "border-primary ring-1 ring-primary/40"
            : "border-line",
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-semibold">
          <span className="text-xs font-normal text-muted">{s.number}</span>
          {s.label}
          <StateBadge state={s.state} label={s.stateLabel} />
        </span>
        <span className="shrink-0 text-xs text-muted tabular">
          {s.done}/{s.total}
        </span>
      </span>
      <ProgressBar done={s.done} total={s.total} state={s.state} />
      <span className="line-clamp-2 text-xs text-text-2">{readable(s.line)}</span>
      <dl className="flex flex-col gap-1.5">
        {facts.map((f) => (
          <Line key={f.label} label={f.label} value={f.value} />
        ))}
      </dl>
      {focus && s.next && (
        <span
          className={cn(
            "mt-auto flex items-start gap-1.5 rounded-lg px-2.5 py-2 text-xs",
            s.next.late ? "bg-bad-soft text-bad" : "bg-primary-soft text-primary",
          )}
        >
          <ArrowRight className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            {s.next.title}
            {s.next.dueOn ? ` · ${s.next.late ? "was due" : "due"} ${date(s.next.dueOn)}` : ""}
          </span>
        </span>
      )}
    </Link>
  );
}

/**
 * The order at a glance: what to do now, the six steps (each links to its
 * page), the money, the key dates and the latest changes; the notes and the
 * order's details at the bottom.
 */
export default async function OrderOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const o = await orderOf(id);
  const [steps, m, flow, recent, deal] = await Promise.all([
    orderStepsOf(id),
    optional(() => orderMoneyOf(id)),
    optional(() => orderFlowOf(id)),
    optional(() => orderHistoryOf(id, undefined, 3)),
    optional(() => api.get<DealDetail>(`/inquiries/${o.inquiry.id}`)),
  ]);
  const base = `/orders/${o.id}`;
  const open = o.status !== "cancelled";
  const c = o.currency;
  const now = today();
  const name = (uid: string | null) => (uid ? (deal?.people[uid] ?? "Someone") : "System");
  const doNow = steps.doNow;
  const finished = o.status === "closed" && !doNow;

  const ship = flow?.shipping?.shipments[0];
  const docs = flow?.documents;
  const required = docs?.set.filter((x) => x.required) ?? [];
  const owing = m?.factories?.rows ?? [];
  const contract = flow?.payment.bankContract;
  const sum = (key: "paid" | "toPay") =>
    owing.length === 1 ? money(owing[0]![key], owing[0]!.currency) : owing.length ? `${owing.length} factories` : null;
  const facts: Record<FlowStep, { label: string; value: ReactNode }[]> = {
    payment: [
      { label: "Received", value: money(o.money.received, c) },
      { label: "Still due", value: money(o.money.due, c) },
    ],
    factory: [
      { label: "Ordered", value: flow?.factory.orderedOn ? date(flow.factory.orderedOn) : "Not yet" },
      owing.length
        ? { label: "Paid to the factory", value: sum("paid") }
        : { label: "Factory", value: flow?.factory.factories.map((f) => f.name).join(", ") || null },
    ],
    production: [
      { label: "Ready", value: o.readyOn ? date(o.readyOn) : "Not known yet" },
      owing.length
        ? { label: "Factory still to pay", value: sum("toPay") }
        : { label: "Goods in", value: o.goods.lines ? `${o.goods.received} of ${o.goods.lines}` : null },
    ],
    shipping: [
      { label: "Ship by", value: o.shipBy ? date(o.shipBy) : null },
      { label: ship?.arrivedOn ? "Arrived" : "ETA", value: ship?.arrivedOn ? date(ship.arrivedOn) : ship?.eta ? date(ship.eta) : null },
    ],
    documents: docs
      ? [
          { label: "Papers ready", value: `${required.filter((x) => x.status === "ready").length} of ${required.length}` },
          { label: "Bank steps", value: `${docs.bankSteps.filter((b) => b.doneOn).length} of ${docs.bankSteps.length}` },
        ]
      : [{ label: "Proforma", value: o.proforma?.number ?? "Not issued" }],
    delivery: [
      { label: "Delivered", value: flow?.delivery?.deliveredOn ? date(flow.delivery.deliveredOn) : "Not yet" },
      {
        label: "SAT",
        value: flow?.delivery?.satDoneOn
          ? `signed ${date(flow.delivery.satDoneOn)}`
          : flow?.delivery?.satPlannedOn
            ? `planned ${date(flow.delivery.satPlannedOn)}`
            : null,
      },
    ],
  };
  const owe = owing.filter((r) => Number(r.toPay) > 0);

  return (
    <div className="flex flex-col gap-5">
      {open && doNow ? (
        <section
          aria-label="Do this now"
          className={cn(
            "flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
            doNow.late ? "border-bad/30 bg-bad-soft" : "border-primary/20 bg-primary-soft/70",
          )}
        >
          <p className={cn("flex min-w-0 items-start gap-2 text-sm", doNow.late && "text-bad")}>
            {doNow.late ? (
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            ) : (
              <ArrowRight className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            )}
            <span>
              <span className="font-semibold">Do this now · {doNow.title}</span>{" "}
              <span className={doNow.late ? "" : "text-text-2"}>
                {doNow.dueOn ? `${doNow.late ? "was due" : "is due"} ${date(doNow.dueOn)}` : doNow.needs ? `needs ${doNow.needs}` : ""} (
                {doNow.label})
              </span>
            </span>
          </p>
          <Link href={`${base}/${STEP_PATH[doNow.step]}`} className={buttonClass(doNow.late ? "danger" : "primary", "sm", "w-fit")}>
            Open {doNow.label}
          </Link>
        </section>
      ) : finished ? (
        <p className="flex items-center gap-2 rounded-xl border border-ok/25 bg-ok-soft px-4 py-3 text-sm">
          <CheckCircle2 className="size-4 shrink-0 text-ok" aria-hidden />
          <span className="font-medium">Done: every step is ticked and the order is closed.</span>
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-label="The steps" className="grid content-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {steps.steps.map((s) => (
            <StepCard key={s.key} s={s} href={`${base}/${STEP_PATH[s.key]}`} facts={facts[s.key]} />
          ))}
        </section>

        <aside className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader title="Money" />
            <dl className="flex flex-col gap-2.5 px-4 py-3.5">
              <Line label="Order total" value={money(o.money.total, c)} />
              <Line label="Received" value={money(o.money.received, c)} tone="text-ok" />
              <Line label="Still due" value={money(o.money.due, c)} tone={Number(o.money.due) > 0 ? "text-warn" : "text-ok"} />
              {m?.factories && (
                <Line
                  label="We owe the factory"
                  value={owe.length === 1 ? money(owe[0]!.toPay, owe[0]!.currency) : owe.length ? `${owe.length} factories` : "Nothing"}
                />
              )}
              {m?.profit && <Line label="Costs spent" value={money(m.profit.expenses, c)} />}
              {m?.profit && (
                <Line
                  label="Expected profit"
                  value={`${money(m.profit.earned, c)}${m.profit.marginPercent !== null ? ` · ${m.profit.marginPercent.toFixed(1)}%` : ""}`}
                  tone={Number(m.profit.earned) < 0 ? "text-bad" : undefined}
                />
              )}
            </dl>
          </Card>
          <Card>
            <CardHeader title="Key dates" />
            <dl className="flex flex-col gap-2.5 px-4 py-3.5">
              <Line label="Ordered" value={date(o.orderedOn)} />
              <Line label="Ready" value={o.readyOn ? date(o.readyOn) : null} />
              <Line label="Ship by" value={o.shipBy ? date(o.shipBy) : null} />
              {contract?.expiresOn && (
                <Line
                  label={flow?.payment.route === "letter_of_credit" ? "LC expires" : "Contract expires"}
                  value={date(contract.expiresOn)}
                />
              )}
              {ship?.eta && <Line label="ETA" value={date(ship.eta)} />}
              {flow?.delivery?.satPlannedOn && <Line label="SAT" value={date(flow.delivery.satPlannedOn)} />}
            </dl>
          </Card>
          <StepChanges entries={recent ?? []} historyHref={`${base}/history`} showStep />
        </aside>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {deal ? (
          <Card>
            <CardHeader title="Notes" description={`Shared with inquiry ${deal.refNo}`} />
            <CardBody className="flex flex-col gap-4">
              {open && <NoteForm action={orderNoteAction.bind(null, o.id, deal.id)} />}
              {deal.notes.length > 0 ? (
                <ul className="flex flex-col gap-3">
                  {deal.notes.map((n) => (
                    <li key={n.id} className="rounded-lg border border-line p-3">
                      <p className="text-sm whitespace-pre-line">{n.body}</p>
                      <p className="mt-1 text-xs text-muted">
                        {name(n.authorId)} · {dateTime(n.createdAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No notes yet.</p>
              )}
            </CardBody>
          </Card>
        ) : (
          <div />
        )}
        <Card id="details" className="scroll-mt-24">
          <CardHeader title="Details" description="Dates and shipping" />
          <CardBody>
            <DetailsForm
              action={detailsAction.bind(null, o.id)}
              canEdit={can(me, "orders.update") && open}
              today={now}
              fixed={[
                { label: "Incoterm", value: incotermOf(o) },
                { label: "Payment terms", value: termsOf(o) },
                { label: "Ordered on", value: date(o.orderedOn) },
              ]}
              values={{
                shipBy: o.shipBy,
                readyOn: o.readyOn,
                shippedOn: o.shippedOn,
                blNo: o.blNo,
                documentTitle: o.documentTitle,
                portOfDischarge: o.portOfDischarge,
              }}
              shown={{
                shipBy: o.shipBy ? date(o.shipBy) : "Not set",
                readyOn: o.readyOn ? date(o.readyOn) : "Not known yet",
                shippedOn: o.shippedOn ? date(o.shippedOn) : "Not shipped",
                blNo: o.blNo ?? "—",
              }}
            />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
