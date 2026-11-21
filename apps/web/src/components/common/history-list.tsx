import { MessageSquareQuote } from "lucide-react";
import { cn, Table, Td, Th, THead, Tr, RULES } from "@kebo/ui";
import type { HistoryEntry } from "@/lib/types";
import { dateTime } from "@/lib/format";
import { INQUIRY_STAGE_LABEL, ORDER_STAGE_LABEL } from "@kebo/shared";
import { readableHistory } from "@/components/insights/readable-dates";

/** Field names as people say them. */
const FIELD: Record<string, string> = {
  blNo: "B/L number",
  shippedOn: "Shipped on",
  departedOn: "Left on",
  containerNo: "Container",
  shipBy: "Ship by",
  readyOn: "Ready on",
  onHold: "On hold",
  lookedAfterBy: "Looked after by",
  taxNo: "Tax no.",
  regNo: "Reg. no.",
  defaultCurrency: "Currency",
  validUntil: "Valid until",
  documentTitle: "Document title",
  portOfDischarge: "Port of discharge",
  contactPerson: "Contact person",
  bankDetails: "Bank details",
  exchangeRates: "Exchange rates",
  defaultMarginPercent: "Default margin %",
  defaultDepositPercent: "Default deposit %",
  defaultBalanceTerms: "Balance terms",
  defaultPaymentTerms: "Payment terms",
  defaultDeliveryTerms: "Incoterm",
  warrantyTerms: "Warranty",
  paymentTerms: "Payment terms",
  deliveryTerms: "Incoterm",
  warranty: "Warranty",
  incotermPlace: "Place",
  leadTime: "Lead time",
  deliveryConditions: "Delivery conditions",
  paymentConditions: "Payment conditions",
  notes: "Notes",
  printQuotedTerms: "Agreed payment conditions printed",
  sentVia: "Sent by",
  step: "Stage",
};
/** Not for people: a record's id (by its name or by its value), and the "yes, save it anyway" a form sends. */
const HIDDEN = /^(ask|id|.+Id|followUp)$/;
const IS_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A stage's word, not its key ("sourcing" → "Sourcing"). */
const STAGE: Record<string, string> = { ...ORDER_STAGE_LABEL, ...INQUIRY_STAGE_LABEL };
const hidden = (c: { field: string; from: string | null; to: string | null }) => HIDDEN.test(c.field) || IS_ID.test(c.to ?? "") || IS_ID.test(c.from ?? "");
const fieldLabel = (f: string) => FIELD[f] ?? f.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
const shown = (v: string | null) =>
  v === null ? "—" : v === "true" ? "yes" : v === "false" ? "no" : (STAGE[v] ?? readableHistory(v.length > 80 ? `${v.slice(0, 80)}…` : v));

const AREA: Record<string, string> = {
  factory_quote: "Supplier prices",
  quotation: "Quotation",
  attachment: "Files",
  order: "Order",
  customer: "Customer",
  factory: "Supplier",
};

/**
 * The same history as a table (board InquiryHistory): When, Who, What changed —
 * the summary, then each field's old → new, and the reason under it.
 */
export function HistoryTable({
  entries,
  showArea = false,
  empty = "Nothing has changed yet.",
  tags,
}: {
  entries: HistoryEntry[];
  showArea?: boolean;
  empty?: string;
  /** A last column with one word per change, by its id (an order: the stage it belongs to). */
  tags?: { label: string; of: Record<string, string | undefined> };
}) {
  if (!entries.length) return <p className={cn(RULES.box.inset, "py-6 text-sm text-muted")}>{empty}</p>;
  return (
    // A fixed layout: the columns keep their widths, and on a phone the one column takes the box (in an auto layout a
    // long change made it wider than the screen).
    // data-fit: made to fit a phone (one column there), so the phone tables' 36rem minimum does not apply.
    <Table className="table-fixed" data-fit="">
      <THead>
        <tr>
          {/* On a phone one column: what changed, with when and who under it (three columns squeezed it). */}
          <Th className={cn(tags ? "w-40" : "w-44", "max-sm:hidden")}>When</Th>
          <Th className={cn(tags ? "w-28" : "w-36", "max-sm:hidden")}>Who</Th>
          <Th>What changed</Th>
          {tags && <Th className="w-36 max-sm:hidden">{tags.label}</Th>}
        </tr>
      </THead>
      <tbody>
        {entries.map((e) => (
          <Tr key={e.id}>
            <Td className="align-top whitespace-nowrap max-sm:hidden">{dateTime(e.at)}</Td>
            <Td className="align-top max-sm:hidden">{e.by?.name ?? "System"}</Td>
            <Td className="[overflow-wrap:anywhere]">
              {showArea && AREA[e.entityType] && <span className="mr-1.5 rounded bg-surface-2 px-1.5 py-0.5 text-xs text-text-2">{AREA[e.entityType]}</span>}
              {e.summary ? readableHistory(e.summary) : e.action.replace(/_/g, " ")}
              {e.changes
                .filter((c) => !hidden(c))
                .slice(0, 8)
                .map((c) => (
                  <span key={c.field}>
                    {" · "}
                    {fieldLabel(c.field)} {shown(c.from)} → <strong>{shown(c.to)}</strong>
                  </span>
                ))}
              <span className="mt-0.5 block text-xs text-muted sm:hidden">
                {dateTime(e.at)} · {e.by?.name ?? "System"}
                {tags?.of[e.id] ? ` · ${tags.of[e.id]}` : ""}
              </span>
              {e.reason && (
                <span className="mt-0.5 flex items-start gap-1.5 text-xs text-text-2">
                  <MessageSquareQuote className="mt-0.5 size-3.5 shrink-0 text-info" aria-hidden />
                  <span>
                    <span className="sr-only">Reason: </span>
                    {e.reason}
                  </span>
                </span>
              )}
            </Td>
            {tags && (
              <Td className="align-top max-sm:hidden">
                {tags.of[e.id] && <span className="rounded-md bg-surface-2 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-text-2">{tags.of[e.id]}</span>}
              </Td>
            )}
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
