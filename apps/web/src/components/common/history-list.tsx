import { MessageSquareQuote } from "lucide-react";
import type { HistoryEntry } from "@/lib/types";
import { dateTime } from "@/lib/format";

/** Field names as people say them. */
const FIELD: Record<string, string> = {
  blNo: "B/L number",
  shippedOn: "Shipped on",
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
};
const fieldLabel = (f: string) => FIELD[f] ?? f.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
const shown = (v: string | null) =>
  v === null ? "—" : v === "true" ? "yes" : v === "false" ? "no" : v.length > 80 ? `${v.slice(0, 80)}…` : v;

const AREA: Record<string, string> = {
  factory_quote: "Factory prices",
  quotation: "Quotation",
  attachment: "Files",
  order: "Order",
  customer: "Customer",
  factory: "Factory",
};

/**
 * A record's history (GET /history): who, when, what changed (old → new) and
 * why. On a deal it also shows its factory prices, quotation, files and order.
 */
export function HistoryList({
  entries,
  showArea = false,
  empty = "Nothing has changed yet.",
}: {
  entries: HistoryEntry[];
  showArea?: boolean;
  empty?: string;
}) {
  if (!entries.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ol className="flex flex-col divide-y divide-line">
      {entries.map((e) => (
        <li key={e.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
          <p className="text-sm">
            {showArea && AREA[e.entityType] && (
              <span className="mr-1.5 rounded bg-surface-2 px-1.5 py-0.5 text-xs text-text-2">{AREA[e.entityType]}</span>
            )}
            {e.summary ?? e.action.replace(/_/g, " ")}
          </p>
          {e.reason && (
            <p className="flex items-start gap-1.5 text-sm text-text-2">
              <MessageSquareQuote className="mt-0.5 size-3.5 shrink-0 text-info" aria-hidden />
              <span>
                <span className="sr-only">Reason: </span>
                {e.reason}
              </span>
            </p>
          )}
          {e.changes.length > 0 && (
            <ul className="flex flex-col gap-0.5 text-xs text-text-2">
              {e.changes.slice(0, 8).map((c) => (
                <li key={c.field}>
                  <span className="text-muted">{fieldLabel(c.field)}:</span>{" "}
                  <span className="line-through decoration-muted/60">{shown(c.from)}</span> →{" "}
                  <span className="text-text">{shown(c.to)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted">
            {e.by?.name ?? "System"} · {dateTime(e.at)}
          </p>
        </li>
      ))}
    </ol>
  );
}
