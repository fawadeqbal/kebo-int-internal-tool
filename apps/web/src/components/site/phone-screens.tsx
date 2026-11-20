import type { ReactNode } from "react";
import { ArrowLeft, Bell, Check, ChevronRight, ClipboardList, Ellipsis, House, ListFilter, Lock, Menu, Plus, Search } from "lucide-react";
import { cn } from "@kebo/ui";

/**
 * The app's own phone screens, drawn for the marketing page at their real size (390 × 844) with the app's sizes
 * and colours (design "RFQ Desk — marketing page", the App screen artboards): the record's top bar, tabs with a
 * fading edge, the panel bar, cards, badges, the next step pinned at the bottom. Sample data, never live.
 */

export type ScreenKey = "order" | "offers" | "quotation" | "invoice" | "packing" | "shipping" | "money";

const NUM = "tabular-nums";

type Tone = "ok" | "info" | "warn" | "neutral" | "act";
const TONE: Record<Tone, string> = {
  ok: "bg-ok-soft text-ok",
  info: "bg-info-soft text-info",
  warn: "bg-warn-soft text-warn",
  neutral: "bg-surface-3 text-text-2",
  act: "bg-action-soft text-action",
};

function Pill({ tone = "neutral", dot, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap",
        TONE[tone],
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

function Screen({ children }: { children: ReactNode }) {
  return <div className="relative flex h-[844px] w-[390px] flex-col overflow-hidden bg-bg text-sm leading-5 text-text">{children}</div>;
}

function RecordBar({ name, under }: { name: string; under: string }) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-1 border-b border-line bg-surface pr-1.5 pl-1">
      <span className="grid size-11 place-items-center">
        <ArrowLeft className="size-[22px]" />
      </span>
      <div className="min-w-0 flex-1 pl-0.5">
        <p className="truncate text-[16.5px] leading-5 font-bold">{name}</p>
        <p className="truncate text-[12px] leading-4 font-medium text-muted">{under}</p>
      </div>
      <span className="grid size-11 place-items-center text-text-2">
        <Ellipsis className="size-[22px]" />
      </span>
    </div>
  );
}

function AppBar({ title }: { title: string }) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-1 border-b border-line bg-surface pr-3 pl-1.5">
      <span className="grid size-11 place-items-center">
        <Menu className="size-[22px]" />
      </span>
      <p className="min-w-0 flex-1 truncate text-[17px] leading-5 font-bold">{title}</p>
      <span className="grid size-10 place-items-center text-text-2">
        <Search className="size-5" />
      </span>
      <span className="relative grid size-10 place-items-center text-text-2">
        <Bell className="size-5" />
        <span className="absolute top-1 right-0.5 h-[18px] min-w-[18px] rounded-full bg-action-solid px-1 text-center text-[10px] leading-[18px] font-bold text-white">
          2
        </span>
      </span>
      <Initials text="SK" size="ml-1 size-8 text-xs" />
    </div>
  );
}

function Initials({ text, size = "size-6 text-[10.5px]" }: { text: string; size?: string }) {
  return <span className={cn("grid shrink-0 place-items-center rounded-full bg-primary-soft font-bold text-primary", size)}>{text}</span>;
}

function Body({ children }: { children: ReactNode }) {
  return <div className="min-h-0 flex-1 overflow-hidden px-4 pt-[18px]">{children}</div>;
}

function StateLine({ pill, text }: { pill: ReactNode; text: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-[13px] leading-[18px] text-muted">
      {pill}
      <span className="truncate">{text}</span>
    </div>
  );
}

const ORDER_TABS = ["Overview", "Payment", "Production", "Goods", "Packing", "Shipping", "Delivery", "Costs", "History"];

function Tabs({ items, on }: { items: string[]; on: string }) {
  // The open tab in view, the rest running off the edge, as the app scrolls them.
  const start = Math.max(0, items.indexOf(on) - 1);
  return (
    <div className="relative -mx-4 mt-3.5 border-b border-line">
      <div className="flex gap-[22px] overflow-hidden px-4 whitespace-nowrap">
        {items.slice(start).map((t) => (
          <span
            key={t}
            className={cn(
              "shrink-0 pb-2.5",
              t === on ? "font-semibold text-primary shadow-[inset_0_-2px_0_var(--primary-solid)]" : "font-medium text-muted",
            )}
          >
            {t}
          </span>
        ))}
      </div>
      <div className="absolute inset-y-0 right-0 w-11 bg-gradient-to-r from-transparent to-bg" />
    </div>
  );
}

function PanelBar({ fact, late = true }: { fact: string; late?: boolean }) {
  return (
    <div className="mt-3 flex h-11 items-center gap-2.5 rounded-xl border border-line bg-surface pr-2.5 pl-3 text-[13px]">
      <Initials text="SK" />
      <span className="font-semibold">Sara Khan</span>
      <span className="text-line-strong">·</span>
      <span className={cn("flex-1 truncate font-semibold", late ? "text-action" : "text-muted")}>{fact}</span>
      <ChevronRight className="size-[18px] text-muted" />
    </div>
  );
}

function Box({ title, right, children, flush }: { title: string; right?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <div className={cn("mt-3 rounded-2xl border border-line bg-surface", flush ? "overflow-hidden" : "px-4 pt-3.5 pb-4")}>
      <div className={cn("mb-2.5 flex items-center justify-between gap-2", flush && "mb-0 border-b border-line px-4 py-3")}>
        <span className="text-[15px] font-semibold">{title}</span>
        {right === undefined ? <span className="text-[13px] font-semibold text-primary">Edit</span> : right}
      </div>
      {children}
    </div>
  );
}

function PayRow({ what, when, amount, pill, first }: { what: string; when: string; amount: string; pill: ReactNode; first?: boolean }) {
  return (
    <div className={cn("flex items-center gap-3 py-2.5", !first && "border-t border-line")}>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{what}</p>
        <p className="text-[12.5px] leading-[18px] text-muted">{when}</p>
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className={cn("font-semibold", NUM)}>{amount}</span>
        {pill}
      </div>
    </div>
  );
}

function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <div>
      {rows.map(([k, v], i) => (
        <div key={k} className={cn("flex justify-between gap-3 py-[7px] text-[13.5px]", i > 0 && "border-t border-line")}>
          <span className="text-muted">{k}</span>
          <span className="text-right font-medium">{v}</span>
        </div>
      ))}
    </div>
  );
}

function Dock({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-x-0 bottom-0 flex gap-2 border-t border-line bg-surface px-3 pt-2 pb-[30px] shadow-[0_-4px_12px_rgb(0_0_0/0.06)]">
      {children}
    </div>
  );
}

function Strong({ children }: { children: ReactNode }) {
  return (
    <span className="grid h-12 min-w-0 flex-1 place-items-center rounded-[10px] bg-action-solid text-[15px] font-bold text-white shadow-[0_6px_16px_rgba(194,81,10,0.28)]">
      {children}
    </span>
  );
}

function Soft({ children }: { children: ReactNode }) {
  return (
    <span className="grid h-12 min-w-0 flex-1 place-items-center rounded-[10px] border border-line-strong bg-surface text-[15px] font-semibold">
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------- the screens */

function OrderScreen() {
  return (
    <Screen>
      <RecordBar name="Blister packing machine + 1 more" under="Order · SO-2026-0042" />
      <Body>
        <StateLine
          pill={
            <Pill tone="info" dot>
              In production
            </Pill>
          }
          text="Al Noor Pharma · Pakistan · USD 48,600.00"
        />
        <Tabs items={ORDER_TABS} on="Payment" />
        <PanelBar fact="Follow-up today" />
        <Box title="From the customer">
          <p className={cn("text-[22px] leading-7 font-bold", NUM)}>USD 14,580.00</p>
          <p className="mt-0.5 text-[13px] text-muted">received of USD 48,600.00 · 30%</p>
          <div className="mt-2.5 mb-1 h-2 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full w-[30%] rounded-full bg-primary-solid" />
          </div>
          <PayRow first what="Deposit · 30%" when="With the proforma" amount="USD 14,580.00" pill={<Pill tone="ok">Paid 14 Nov</Pill>} />
          <PayRow what="Balance · 70%" when="Before shipping" amount="USD 34,020.00" pill={<Pill tone="info">Sent 18 Nov</Pill>} />
        </Box>
        <Box title="To Jinan Pharma Machinery">
          <PayRow
            first
            what="Deposit · 30%"
            when="With the purchase order"
            amount="CNY 93,600.00"
            pill={<Pill tone="ok">Paid 16 Nov</Pill>}
          />
          <PayRow what="Balance · 70%" when="When ready" amount="CNY 218,400.00" pill={<Pill>Planned</Pill>} />
        </Box>
      </Body>
      <Dock>
        <Strong>Record a payment</Strong>
      </Dock>
    </Screen>
  );
}

function ListLine({
  title,
  end,
  line,
  stands,
  first,
  who,
}: {
  title: string;
  end: ReactNode;
  line: string;
  stands: ReactNode;
  first?: boolean;
  who?: string;
}) {
  return (
    <div className={cn("px-4 py-3 text-[13px] leading-[18px]", !first && "border-t border-line")}>
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-[14.5px] leading-5 font-semibold">{title}</span>
        <span className={cn("text-[13.5px] font-semibold", NUM)}>{end}</span>
      </div>
      <p className="mt-px truncate text-text-2">{line}</p>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="flex min-w-0 flex-1 items-center gap-2">{stands}</span>
        {who && <Initials text={who} size="size-[22px] text-[9.5px]" />}
      </div>
    </div>
  );
}

function OffersScreen() {
  return (
    <Screen>
      <RecordBar name="Blister packing machine + 1 more" under="Inquiry · RFQ-2026-0011" />
      <Body>
        <StateLine
          pill={
            <Pill tone="info" dot>
              Sourcing
            </Pill>
          }
          text="Al Noor Pharma · Pakistan · needed by 15 Jan 2027"
        />
        <Tabs items={["Overview", "Items", "Supplier offers", "Quotations", "History"]} on="Supplier offers" />
        <PanelBar fact="Follow-up Fri 20 Nov" late={false} />
        <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="flex items-center justify-between border-b border-line py-2.5 pr-3 pl-4">
            <div>
              <p className="text-[15px] font-semibold">Supplier offers</p>
              <p className="text-[12.5px] text-muted">3 asked · 2 offers in</p>
            </div>
            <span className="inline-flex h-8 rounded-[10px] bg-surface-2 p-0.5 text-[13px]">
              <span className="grid place-items-center px-2.5 text-muted">List</span>
              <span className="grid place-items-center rounded-lg bg-surface px-2.5 font-semibold shadow-[0_1px_2px_rgb(21_33_26/.08)]">
                Compare
              </span>
            </span>
          </div>
          <ListLine
            first
            title="Jinan Pharma Machinery"
            end="CNY 312,000.00"
            line="with 13% tax added · 45 days · EXW"
            stands={
              <>
                <Pill tone="ok">Lowest</Pill>
                <span className="text-text-2">In quotation A</span>
              </>
            }
          />
          <ListLine
            title="Wenzhou Pack Tech"
            end="CNY 336,500.00"
            line="with 13% tax added · 30 days · FOB Ningbo"
            stands={
              <>
                <Pill tone="ok">Fastest</Pill>
                <span className="text-text-2">Offer in</span>
              </>
            }
          />
          <ListLine
            title="Ruian Hualian"
            end={<span className="font-medium text-muted">No prices yet</span>}
            line="asked 15 Nov 2026 · reply by 22 Nov"
            stands={<Pill tone="warn">Waiting 3 days</Pill>}
          />
        </div>
        <div className="mt-3 flex items-center gap-2.5 rounded-xl bg-ok-soft px-3 py-2.5 text-[13px] font-medium text-ok">
          <Check className="size-[18px]" />
          Lowest saves CNY 24,500.00 against the next
        </div>
      </Body>
      <Dock>
        <Strong>Make a quotation</Strong>
      </Dock>
    </Screen>
  );
}

function ItemLine({
  no,
  name,
  model,
  qty,
  amount,
  first,
}: {
  no: string;
  name: string;
  model: string;
  qty: string;
  amount: string;
  first?: boolean;
}) {
  return (
    <div className={cn("flex gap-2.5 py-3", !first && "border-t border-line")}>
      <span className={cn("w-[22px] shrink-0 text-[13px] font-semibold text-muted", NUM)}>{no}</span>
      <div className="min-w-0 flex-1">
        <p className="leading-[19px] font-semibold">{name}</p>
        <p className="text-[12.5px] leading-[17px] text-muted">{model}</p>
        <div className={cn("mt-1.5 flex justify-between text-[13px]", NUM)}>
          <span className="text-text-2">{qty}</span>
          <span className="font-semibold">{amount}</span>
        </div>
      </div>
      <ChevronRight className="size-4 self-center text-muted" />
    </div>
  );
}

function QuotationScreen() {
  return (
    <Screen>
      <RecordBar name="Quotation for Al Noor Pharma" under="Quotation · QUO-2026-0018 · R1" />
      <Body>
        <StateLine pill={<Pill dot>Draft</Pill>} text="Option A · Jinan Pharma Machinery · valid until 20 Dec 2026" />
        <Box title="Prices">
          <p className="-mt-1 text-[12.5px] text-muted">2 items · USD · no tax</p>
          <ItemLine first no="1" name="Blister packing machine" model="DPP-260" qty="1 set × 42,800.00" amount="42,800.00" />
          <ItemLine no="2" name="Change parts set" model="DPP-260-CP" qty="2 set × 2,900.00" amount="5,800.00" />
          <div
            className={cn(
              "mt-1.5 rounded-[10px] border border-dashed border-money/40 bg-money-soft px-3 py-2.5 text-[13px] text-money",
              NUM,
            )}
          >
            <p className="text-[11.5px] font-bold tracking-wide">OURS ONLY · NEVER PRINTED</p>
            <div className="mt-1 flex justify-between">
              <span>Our cost</span>
              <span className="font-semibold">USD 40,150.00</span>
            </div>
            <div className="flex justify-between">
              <span>Margin</span>
              <span className="font-bold">USD 8,450.00 · 17.4%</span>
            </div>
          </div>
          <div className={cn("mt-3 flex items-baseline justify-between", NUM)}>
            <span className="text-muted">Total · no tax</span>
            <span className="text-lg font-bold">USD 48,600.00</span>
          </div>
        </Box>
        <Box title="Delivery & payment">
          <Facts
            rows={[
              ["Incoterm", "FOB Shanghai"],
              ["Lead time", "50 days"],
              ["Deposit", "30% with the order"],
              ["Balance", "70% before shipping"],
            ]}
          />
        </Box>
      </Body>
      <Dock>
        <Strong>Send to the customer</Strong>
      </Dock>
    </Screen>
  );
}

/* The printed papers keep the documents' own colours (theme.css: kebo, kebo-deep, kebo-light, kebo-line). */
function PaperHead({ kind, no, sub }: { kind: string; no: string; sub: string }) {
  return (
    <div className="flex items-start justify-between gap-2 border-b-2 border-kebo pb-2.5">
      <div className="flex items-center gap-2">
        <span className="grid size-[34px] place-items-center rounded-[7px] border-[1.5px] border-dashed border-kebo/50 text-center text-[7.5px] leading-[9px] font-bold text-kebo">
          YOUR
          <br />
          LOGO
        </span>
        <div className="leading-[13px]">
          <b className="text-[10.5px]">Your Company Ltd.</b>
          <br />
          <span className="text-[8.5px] text-[#555]">Your address · your phone</span>
        </div>
      </div>
      <div className="text-right leading-[13px]">
        <p className="font-doc-display text-xs font-extrabold tracking-wide text-kebo-deep">{kind}</p>
        <p className={NUM}>{no}</p>
        <p>{sub}</p>
      </div>
    </div>
  );
}

function Paper({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 rounded-md border border-kebo-line bg-white px-3.5 pt-4 pb-3.5 font-doc text-[9px] leading-[12.5px] text-kebo-ink shadow-[0_12px_30px_-14px_rgb(6_60_140/.3)]">
      {children}
    </div>
  );
}

function PaperTable({ head, rows, right, widths }: { head: string[]; rows: string[][]; right: number[]; widths: string[] }) {
  return (
    <table className="mt-2.5 w-full table-fixed border-collapse">
      <colgroup>
        {widths.map((w, i) => (
          <col key={i} style={{ width: w }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {head.map((h, i) => (
            <th
              key={h}
              className={cn(
                "bg-kebo-light px-1 py-1 text-[8.5px] font-semibold text-kebo-deep",
                right.includes(i) ? "text-right" : "text-left",
              )}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, j) => (
          <tr key={j}>
            {r.map((c, i) => (
              <td key={i} className={cn("border-b border-kebo-line p-1", NUM, right.includes(i) ? "text-right" : "text-left")}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function InvoiceScreen() {
  return (
    <Screen>
      <RecordBar name="Proforma invoice" under="PI-2026-0042 · Final · SO-2026-0042" />
      <Body>
        <div className="flex items-center gap-2.5 rounded-xl bg-ok-soft px-3 py-2.5 text-[13px] font-medium text-ok">
          <Lock className="size-[17px]" />
          Kept as sent · 14 Nov 2026 · version 1
        </div>
        <Paper>
          <PaperHead kind="PROFORMA INVOICE" no="No. PI-2026-0042" sub="Date 14 Nov 2026" />
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            <div>
              <p className="text-[8px] font-bold text-kebo-deep">BUYER</p>
              <b>Al Noor Pharma</b>
              <br />
              Lahore, Pakistan
              <br />
              Customer&apos;s order no. ANP-PO-7731
            </div>
            <div>
              <p className="text-[8px] font-bold text-kebo-deep">DELIVERY &amp; PAYMENT</p>
              Incoterm FOB Shanghai
              <br />
              Lead time 50 days
              <br />
              Deposit 30% · Balance 70%
            </div>
          </div>
          <PaperTable
            head={["No.", "Description", "Qty", "Unit price USD", "Amount USD"]}
            rows={[
              ["1", "Blister packing machine DPP-260", "1 set", "42,800.00", "42,800.00"],
              ["2", "Change parts set DPP-260-CP", "2 set", "2,900.00", "5,800.00"],
            ]}
            right={[2, 3, 4]}
            widths={["7%", "41%", "12%", "20%", "20%"]}
          />
          <div className="mt-2 flex justify-end">
            <div className={cn("min-w-[170px]", NUM)}>
              <div className="flex justify-between">
                <span>Total</span>
                <b className="text-[10.5px] text-kebo-deep">USD 48,600.00</b>
              </div>
              <div className="flex justify-between">
                <span>Deposit 30%</span>
                <span>USD 14,580.00</span>
              </div>
              <div className="flex justify-between">
                <span>Balance 70%</span>
                <span>USD 34,020.00</span>
              </div>
            </div>
          </div>
          <div className="mt-2.5 rounded border border-kebo-line bg-kebo-paper px-2 py-1.5">
            <b className="text-kebo-deep">Bank accounts</b>
            <br />
            Your bank · account no. · SWIFT
          </div>
          <div className="mt-3.5 flex items-end justify-between text-[#555]">
            <span>Valid until 20 Dec 2026</span>
            <span className="min-w-24 border-t border-kebo-gold pt-0.5 text-center">Signed and stamped</span>
          </div>
        </Paper>
      </Body>
      <Dock>
        <Soft>Print</Soft>
        <Strong>Download PDF</Strong>
      </Dock>
    </Screen>
  );
}

function Package({
  name,
  goods,
  weight,
  size,
  cbm,
  first,
}: {
  name: string;
  goods: string;
  weight: string;
  size: string;
  cbm: string;
  first?: boolean;
}) {
  return (
    <div className={cn("py-[11px]", !first && "border-t border-line")}>
      <div className="flex justify-between gap-2">
        <span className="font-semibold">{name}</span>
        <span className={cn("font-semibold", NUM)}>{cbm}</span>
      </div>
      <p className="text-[13px] leading-[18px] text-text-2">{goods}</p>
      <p className={cn("text-[12.5px] leading-[17px] text-muted", NUM)}>
        {weight} · {size}
      </p>
    </div>
  );
}

function PackingScreen() {
  return (
    <Screen>
      <RecordBar name="Blister packing machine + 1 more" under="Order · SO-2026-0042" />
      <Body>
        <StateLine
          pill={
            <Pill tone="info" dot>
              In production
            </Pill>
          }
          text="Al Noor Pharma · ready 12 Dec 2026"
        />
        <Tabs items={ORDER_TABS} on="Packing" />
        <Box title="Packages" right={<Pill tone="ok">Final</Pill>}>
          <Package
            first
            name="1 wooden case"
            goods="Blister packing machine · DPP-260"
            weight="Net 2,600 kg · gross 2,850 kg"
            size="4.2 × 1.6 × 1.9 m"
            cbm="12.77 CBM"
          />
          <Package
            name="2 cartons"
            goods="Change parts set · DPP-260-CP"
            weight="Net 180 kg · gross 205 kg"
            size="1.2 × 0.8 × 0.9 m each"
            cbm="1.73 CBM"
          />
          <div className={cn("mt-1.5 grid grid-cols-4 gap-1.5 rounded-[10px] border border-line bg-faint p-2.5 text-xs leading-4", NUM)}>
            {[
              ["Packages", "3"],
              ["Net", "2,780 kg"],
              ["Gross", "3,055 kg"],
              ["Volume", "14.50 CBM"],
            ].map(([k, v]) => (
              <div key={k}>
                <span className="text-muted">{k}</span>
                <br />
                <b className="text-[13.5px]">{v}</b>
              </div>
            ))}
          </div>
        </Box>
        <Box title="For the papers">
          <Facts
            rows={[
              ["Shipping marks", "ANP · LAHORE"],
              ["Container", "1 × 40' HQ"],
              ["Papers", "Packing list · Commercial invoice"],
            ]}
          />
        </Box>
      </Body>
      <Dock>
        <Strong>Send the packing list</Strong>
      </Dock>
    </Screen>
  );
}

function ShippingScreen() {
  const steps: { t: string; s?: string; st?: "done" | "next" }[] = [
    { t: "Booked", s: "20 Nov 2026 · BK-778120", st: "done" },
    { t: "Ready at the supplier", s: "Planned 12 Dec 2026", st: "next" },
    { t: "Loaded on the vessel", s: "ETD 15 Dec 2026 · Shanghai" },
    { t: "Arrived", s: "ETA 8 Jan 2027 · Karachi" },
    { t: "Cleared" },
    { t: "Delivered" },
  ];
  return (
    <Screen>
      <RecordBar name="Blister packing machine + 1 more" under="Order · SO-2026-0042" />
      <Body>
        <StateLine
          pill={
            <Pill tone="info" dot>
              Booked
            </Pill>
          }
          text="By sea · Shanghai → Karachi · 1 × 40' HQ"
        />
        <Tabs items={ORDER_TABS} on="Shipping" />
        <Box title="Where the goods are" right={null}>
          {steps.map((x, i) => {
            const last = i === steps.length - 1;
            return (
              <div key={x.t} className={cn("flex gap-3", last ? "min-h-6" : "min-h-11")}>
                <div className="flex w-[22px] flex-col items-center">
                  {x.st === "done" ? (
                    <span className="grid size-[22px] place-items-center rounded-full bg-primary-solid text-white">
                      <Check className="size-[13px]" strokeWidth={3} />
                    </span>
                  ) : x.st === "next" ? (
                    <span className="grid size-[22px] place-items-center rounded-full border-2 border-primary-solid bg-surface">
                      <span className="size-2 rounded-full bg-primary-solid" />
                    </span>
                  ) : (
                    <span className="size-[22px] rounded-full border-2 border-line-strong bg-surface" />
                  )}
                  {!last && <span className={cn("my-0.5 w-0.5 flex-1", x.st === "done" ? "bg-primary-solid" : "bg-line")} />}
                </div>
                <div className="pt-px pb-2">
                  <p className={x.st ? "font-semibold" : "font-medium text-muted"}>{x.t}</p>
                  {x.s && <p className={cn("text-[12.5px] leading-[17px] text-muted", NUM)}>{x.s}</p>}
                </div>
              </div>
            );
          })}
        </Box>
        <Box title="Papers the customer needs" right={null}>
          <div className="flex flex-wrap gap-1.5">
            <Pill tone="ok">Packing list</Pill>
            <Pill tone="ok">Commercial invoice</Pill>
            <Pill tone="warn">Certificate of origin</Pill>
            <Pill>B/L</Pill>
          </div>
          <p className="mt-2 text-[12.5px] text-muted">Certificate of origin: ask the supplier · B/L after loading</p>
        </Box>
      </Body>
      <Dock>
        <Strong>Add the B/L</Strong>
      </Dock>
    </Screen>
  );
}

function MoneyScreen() {
  const chip = (t: string, n: string, on = false) => (
    <span
      key={t}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px]",
        on ? "border-primary-line bg-primary-soft font-semibold text-primary" : "border-line bg-surface text-text-2",
      )}
    >
      {t}
      <span className="text-xs opacity-80">{n}</span>
    </span>
  );
  return (
    <Screen>
      <AppBar title="To receive and to pay" />
      <Body>
        <p className={cn("text-[13px] leading-[18px] text-muted", NUM)}>
          To receive <b className="text-text">USD 34,020.00</b> · to pay <b className="text-text">CNY 218,400.00</b>
        </p>
        <div className="-mx-4 mt-3 flex gap-2 overflow-hidden px-4 whitespace-nowrap">
          {chip("All", "4", true)}
          {chip("To receive", "1")}
          {chip("To pay", "1")}
          {chip("To check", "1")}
        </div>
        <div className="mt-3 flex gap-2">
          <span className="flex h-11 flex-1 items-center gap-2 rounded-[10px] border border-line-strong bg-surface px-3 text-base text-muted">
            <Search className="size-[18px]" />
            Search…
          </span>
          <span className="flex h-11 items-center gap-1.5 rounded-[10px] border border-line-strong bg-surface px-3.5 font-semibold">
            <ListFilter className="size-[18px]" />
            Filters
          </span>
        </div>
        <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-surface">
          <ListLine
            first
            who="SK"
            title="Balance from Al Noor Pharma"
            end="USD 34,020.00"
            line="SO-2026-0042 · before shipping"
            stands={<Pill tone="info">Sent 18 Nov</Pill>}
          />
          <ListLine
            who="SK"
            title="Deposit from Gulf Medical Supply"
            end="USD 9,200.00"
            line="SO-2026-0045 · proof attached"
            stands={<Pill tone="act">To check · a second person</Pill>}
          />
          <ListLine
            who="SK"
            title="Deposit from Al Noor Pharma"
            end="USD 14,580.00"
            line="SO-2026-0042 · receipt RC-2026-0031"
            stands={<Pill tone="ok">Paid 14 Nov</Pill>}
          />
          <ListLine
            who="SK"
            title="Balance to Jinan Pharma Machinery"
            end="CNY 218,400.00"
            line="SO-2026-0042 · when ready"
            stands={<Pill>Planned</Pill>}
          />
        </div>
      </Body>
      <div className="absolute inset-x-0 bottom-0 flex items-stretch border-t border-line bg-surface/95 pb-6">
        {(
          [
            ["Home", House],
            ["Inquiries", ClipboardList],
          ] as const
        ).map(([t, I]) => (
          <span key={t} className="flex flex-1 flex-col items-center justify-center gap-1 pt-2 pb-1.5 text-[11px] text-muted">
            <I className="size-[22px]" strokeWidth={1.75} />
            {t}
          </span>
        ))}
        <span className="flex flex-1 items-start justify-center">
          <span className="-mt-5 grid size-14 place-items-center rounded-full bg-action-solid text-white shadow-pop ring-4 ring-bg">
            <Plus className="size-7" strokeWidth={2.25} />
          </span>
        </span>
        {(
          [
            ["Alerts", Bell],
            ["Menu", Menu],
          ] as const
        ).map(([t, I]) => (
          <span key={t} className="flex flex-1 flex-col items-center justify-center gap-1 pt-2 pb-1.5 text-[11px] text-muted">
            <I className="size-[22px]" strokeWidth={1.75} />
            {t}
          </span>
        ))}
      </div>
    </Screen>
  );
}

const SCREENS: Record<ScreenKey, { draw: () => ReactNode; label: string }> = {
  order: { draw: OrderScreen, label: "An order's Payment tab: what the customer paid and what is owed to the supplier" },
  offers: { draw: OffersScreen, label: "An inquiry's supplier offers compared, the lowest and the fastest marked" },
  quotation: { draw: QuotationScreen, label: "A quotation's prices with the margin, which is never printed" },
  invoice: { draw: InvoiceScreen, label: "A proforma invoice on your letterhead, kept as sent" },
  packing: { draw: PackingScreen, label: "An order's packages with weights and volume" },
  shipping: { draw: ShippingScreen, label: "An order's shipping, step by step" },
  money: { draw: MoneyScreen, label: "To receive and to pay: payments in, payments out, and those waiting for a second check" },
};

/** One screen in a phone, scaled to fit (the screen keeps its real 390 × 844 layout inside). */
export function Phone({ screen, className }: { screen: ScreenKey; className?: string }) {
  const s = SCREENS[screen];
  return (
    <figure className={cn("s-phone m-0", className)}>
      <div role="img" aria-label={s.label} className="s-phone-frame">
        <div className="s-phone-glass">
          <div aria-hidden className="s-phone-screen">
            {s.draw()}
          </div>
        </div>
      </div>
    </figure>
  );
}
