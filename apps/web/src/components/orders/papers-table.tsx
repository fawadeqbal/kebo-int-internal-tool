"use client";

import { useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, FileText, MoreHorizontal, Plus, Share2 } from "lucide-react";
import { paperDone, type FlowStep, type PaperKind } from "@kebo/shared";
import { Badge, Button, buttonClass, Card, CardHeader, cn } from "@kebo/ui";
import { FloatingMenu } from "@/components/common/floating";
import type { ActionState } from "@/lib/actions";
import type { PaperRow } from "@/lib/types-papers";
import { downloadHref, FileChip, uploadToOrder, useFileTools } from "@/components/files/file-tools";
import { paperAgainAction, paperDeleteDraftAction } from "@/app/(app)/orders/files-actions";
import { RecordForm, StateMark } from "./papers-card";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;
export type PapersTab = "bank" | "all" | "missing";
/** A row of the table: a paper of GET /orders/:id/papers, or the quotation (its own print page); `links` overrides where it prints. */
export type PaperLineRow = PaperRow & { links?: { view: string; pdf: string; internal?: string } };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string) => `${iso.slice(8, 10)} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

/** Where it comes from: Made by the app, Uploaded, Kept elsewhere, Missing, Can be made… */
function fromOf(r: PaperRow): { label: string; tone: "primary" | "info" | "neutral" | "warn" | "ok" } {
  if (r.source === "app")
    return r.state === "ready" || r.live
      ? { label: "Made by the app", tone: "primary" }
      : r.state === "draft"
        ? { label: "Draft", tone: "info" }
        : r.state === "wait"
          ? { label: "Waiting for data", tone: "warn" }
          : r.state === "up"
            ? { label: "Uploaded", tone: "info" }
            : r.state === "else"
              ? { label: "Kept elsewhere", tone: "neutral" }
              : { label: "Can be made", tone: "primary" };
  return r.state === "up"
    ? { label: "Uploaded", tone: "info" }
    : r.state === "else"
      ? { label: "Kept elsewhere", tone: "neutral" }
      : r.state === "ready"
        ? { label: "Recorded", tone: "ok" }
        : { label: "Missing", tone: "warn" };
}

const GROUPS: { label: string; steps: FlowStep[] }[] = [
  { label: "Payment", steps: ["payment"] },
  { label: "Factory order and production", steps: ["factory", "production"] },
  { label: "Shipping and the bank", steps: ["shipping", "documents"] },
  { label: "Delivery", steps: ["delivery"] },
];

/** The paper's print page (View / Print) and its PDF. */
function printOf(orderId: string, r: PaperLineRow) {
  if (r.links) return r.links;
  if (r.source !== "app" || !r.printable) return null;
  const q = new URLSearchParams({ ...(r.ref ? { ref: r.ref } : {}), back: `/orders/${orderId}/documents` });
  const pq = new URLSearchParams(r.ref ? { ref: r.ref } : {});
  return { view: `/print/orders/${orderId}/${r.kind}?${q}`, pdf: `/pdf/${r.kind}/${orderId}${pq.size ? `?${pq}` : ""}` };
}

/** Where a paper takes a file ("paper:doc:<id>" or "paper:<kind>"), for drops and "Attach the signed scan". */
const attachKey = (r: PaperRow) => (r.doc ? `paper:doc:${r.doc.id}` : r.docKind ? `paper:${r.docKind}` : null);

/**
 * Documents › Papers: every paper of the order once — For the bank (the set the
 * route asks for), All papers (grouped by step) and Missing — with where each
 * comes from, its number and date, its file, one button and the paper's ⋯ menu.
 * Upload and Kept elsewhere open in the row; the footer downloads the set as one
 * PDF (or a zip) and shares it.
 */
export function PapersTable({
  orderId,
  dealId,
  rows,
  tab,
  canMake,
  canRecord,
  addAction,
  updateActions,
  description,
  shipNumber,
  today,
  issueProforma,
}: {
  orderId: string;
  dealId: string;
  rows: PaperLineRow[];
  tab: PapersTab;
  canMake: boolean;
  canRecord: boolean;
  addAction: Action;
  updateActions: Record<string, Action>;
  description: string;
  /** The B/L or AWB number from the shipment, to prefill. */
  shipNumber: string | null;
  today: string;
  /** The proforma's "Issue it" (gets its number dated today). */
  issueProforma?: Action;
}) {
  const tools = useFileTools();
  const [open, setOpen] = useState<{ key: string; mode: "upload" | "elsewhere" } | null>(null);
  const [makeMenu, setMakeMenu] = useState(false);
  const makeRef = useRef<HTMLButtonElement>(null);
  const bank = rows.filter((r) => r.inSet);
  const missing = rows.filter((r) => r.state === "miss");
  const base = `/orders/${orderId}/documents`;
  const shown = tab === "bank" ? bank : tab === "missing" ? missing : rows;
  const ready = bank.filter((r) => paperDone(r.state));
  const still = bank.filter((r) => !paperDone(r.state));
  const makeable = rows.filter((r) => r.makeable && !paperDone(r.state));
  const setKeys = (tab === "bank" ? bank : shown).filter((r) => paperDone(r.state) || r.live);
  const tabs: { key: PapersTab; label: string; n: number }[] = [
    { key: "bank", label: "For the bank", n: bank.length },
    { key: "all", label: "All papers", n: rows.length },
    { key: "missing", label: "Missing", n: missing.length },
  ];

  const row = (r: PaperRow) => (
    <PaperLine
      key={r.key}
      r={r}
      orderId={orderId}
      dealId={dealId}
      canMake={canMake}
      canRecord={canRecord}
      open={open?.key === r.key ? open.mode : null}
      setOpen={(mode) => setOpen(mode ? { key: r.key, mode } : null)}
      addAction={addAction}
      update={r.doc ? updateActions[r.doc.id] : undefined}
      shipNumber={shipNumber}
      today={today}
      issueProforma={r.kind === "proforma" ? issueProforma : undefined}
    />
  );

  return (
    <Card id="papers" className="scroll-mt-24">
      <CardHeader title="Papers" description={description} />
      <div className="flex flex-col px-4 pt-3 pb-3.5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <nav
            aria-label="Papers"
            className="inline-flex max-w-full overflow-x-auto rounded-lg border border-line bg-surface-2 p-0.5 [scrollbar-width:none]"
          >
            {tabs.map((t) => (
              <Link
                key={t.key}
                href={`${base}?tab=${t.key}#papers`}
                scroll={false}
                aria-current={tab === t.key ? "page" : undefined}
                className={cn(
                  "inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium whitespace-nowrap text-muted hover:text-text",
                  tab === t.key && "bg-surface text-text shadow-card",
                )}
              >
                {t.label} · {t.n}
              </Link>
            ))}
          </nav>
          <span className="hidden text-xs text-muted sm:inline">Every paper of the order, once.</span>
        </div>
        <div role="table" aria-label="Papers" className="text-sm">
          <div
            role="row"
            className="hidden grid-cols-[28px_minmax(0,1.35fr)_minmax(0,1fr)_120px_minmax(0,1.25fr)_190px] gap-x-3 border-b border-line px-2 py-2 text-xs font-medium text-text-2 md:grid"
          >
            <span role="columnheader" />
            <span role="columnheader">Paper</span>
            <span role="columnheader">Number · date</span>
            <span role="columnheader">From</span>
            <span role="columnheader">File</span>
            <span role="columnheader" className="sr-only">
              Actions
            </span>
          </div>
          {!shown.length && (
            <p className="px-2 py-4 text-sm text-muted">
              {tab === "missing" ? "Nothing is missing." : tab === "bank" ? "No papers for the bank on this route." : "No papers yet."}
            </p>
          )}
          {tab === "all"
            ? GROUPS.map((g) => {
                const list = shown.filter((r) => g.steps.includes(r.step));
                if (!list.length) return null;
                return (
                  <div key={g.label} role="rowgroup">
                    <p className="px-2 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">{g.label}</p>
                    {list.map(row)}
                  </div>
                );
              })
            : shown.map(row)}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 pt-3">
          <p className="text-xs text-text-2">
            <b className="text-text">
              {ready.length} of {bank.length} ready.
            </b>{" "}
            {still.length ? `Still needed: ${still.map((r) => r.label).join(", ")}.` : bank.length ? "The set can go to the bank." : ""}
          </p>
          <span className="flex flex-wrap items-center gap-1.5">
            {setKeys.length > 0 && (
              <>
                <a
                  href={`/pdf/set/${orderId}?as=pdf&keys=${setKeys.map((r) => encodeURIComponent(r.key)).join(",")}`}
                  className={buttonClass("secondary", "xs")}
                >
                  <Download aria-hidden /> Download the set{tab !== "bank" ? "" : " as one PDF"}
                </a>
                <a
                  href={`/pdf/set/${orderId}?as=zip&keys=${setKeys.map((r) => encodeURIComponent(r.key)).join(",")}`}
                  className={buttonClass("ghost", "xs")}
                >
                  as zip
                </a>
                {tools && (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      tools.open({
                        kind: "share",
                        files: [],
                        papers: setKeys.map((r) => ({ key: r.key, label: [r.label, r.number].filter(Boolean).join(" ") })),
                      })
                    }
                  >
                    <Share2 aria-hidden /> Share…
                  </Button>
                )}
              </>
            )}
            {canMake && makeable.length > 0 && (
              <>
                <button
                  ref={makeRef}
                  type="button"
                  className={buttonClass("ghost", "xs")}
                  aria-haspopup="menu"
                  aria-expanded={makeMenu}
                  onClick={() => setMakeMenu((o) => !o)}
                >
                  <Plus aria-hidden /> Make a paper
                </button>
                {makeMenu && (
                  <FloatingMenu anchor={() => makeRef.current} onClose={() => setMakeMenu(false)} label="Make a paper" width={260}>
                    {makeable.map((r) => (
                      <Link
                        key={r.key}
                        role="menuitem"
                        href={`/orders/${orderId}/papers/${r.kind}${r.ref ? `?ref=${r.ref}` : ""}`}
                        className="flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-sm hover:bg-surface-2 focus:bg-surface-2 focus:outline-none"
                      >
                        <span className="truncate">{r.label}</span>
                        <span className="text-xs text-muted">{r.stateLabel.toLowerCase()}</span>
                      </Link>
                    ))}
                  </FloatingMenu>
                )}
              </>
            )}
          </span>
        </div>
      </div>
    </Card>
  );
}

function PaperLine({
  r,
  orderId,
  dealId,
  canMake,
  canRecord,
  open,
  setOpen,
  addAction,
  update,
  shipNumber,
  today,
  issueProforma,
}: {
  r: PaperLineRow;
  orderId: string;
  dealId: string;
  canMake: boolean;
  canRecord: boolean;
  open: "upload" | "elsewhere" | null;
  setOpen: (m: "upload" | "elsewhere" | null) => void;
  addAction: Action;
  update?: Action;
  shipNumber: string | null;
  today: string;
  issueProforma?: Action;
}) {
  const tools = useFileTools();
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const [busy, start] = useTransition();
  const more = useRef<HTMLButtonElement>(null);
  const scanId = useId();
  const from = fromOf(r);
  const print = printOf(orderId, r);
  const make = r.makeable ? `/orders/${orderId}/papers/${r.kind}${r.ref ? `?ref=${r.ref}` : ""}` : null;
  const file = r.doc?.file ? (tools?.files.find((f) => f.sourceId === r.doc!.file!.id) ?? null) : null;
  const isDate = r.doc?.issuedOn ?? (/\d{4}-\d{2}-\d{2}/.exec(r.sub)?.[0] || null);
  const numberLine = [r.number, isDate ? day(isDate) : null].filter(Boolean).join(" · ") || "—";
  const recordable = r.docKind && canRecord;
  const drop = attachKey(r);

  const issue =
    issueProforma && r.state === "can" ? (
      <Button
        size="xs"
        variant="secondary"
        disabled={busy}
        onClick={() =>
          window.confirm(
            "Issue the proforma now? It gets its number dated today (your letters, the date, the customer's letters, the handler's count) and the number does not change afterwards.",
          ) &&
          start(async () => {
            const res = await issueProforma({}, new FormData());
            if (!res.ok) window.alert(res.message ?? "Something went wrong.");
            router.refresh();
          })
        }
      >
        Issue it
      </Button>
    ) : null;
  const action = issue ? (
    <>
      {issue}
      {print && (
        <Link href={print.view} target="_blank" className={buttonClass("ghost", "xs", "hidden sm:inline-flex")}>
          View / Print
        </Link>
      )}
    </>
  ) : r.source === "upload" && recordable && (r.state === "miss" || r.state === "draft") ? (
    <>
      <Button size="xs" variant="secondary" onClick={() => setOpen("upload")}>
        Upload
      </Button>
      <Button size="xs" variant="ghost" className="hidden sm:inline-flex" onClick={() => setOpen("elsewhere")}>
        Kept elsewhere…
      </Button>
    </>
  ) : r.state === "else" && recordable ? (
    <Button size="xs" variant="ghost" onClick={() => setOpen("elsewhere")}>
      Change
    </Button>
  ) : make && canMake && !r.live && (r.state === "can" || r.state === "wait" || r.state === "draft") ? (
    <Link href={make} className={buttonClass(r.state === "draft" ? "primary" : "secondary", "xs")}>
      {r.state === "draft" ? "Continue" : "Make"}
    </Link>
  ) : print && (paperDone(r.state) || r.live) ? (
    <Link href={print.view} target="_blank" className={buttonClass("ghost", "xs")}>
      View / Print
    </Link>
  ) : file ? (
    <Button size="xs" variant="ghost" onClick={() => tools?.view(file)}>
      View
    </Button>
  ) : r.kind === "packing-list" && r.state === "wait" ? (
    <Link href={`/orders/${orderId}/shipping#packing`} className={buttonClass("secondary", "xs")}>
      Make it
    </Link>
  ) : null;

  const item = (label: string, on: () => void, hint?: string, danger?: boolean) => (
    <button
      type="button"
      role="menuitem"
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-surface-2 focus:bg-surface-2 focus:outline-none",
        danger && "text-bad",
      )}
      onClick={() => {
        setMenu(false);
        on();
      }}
    >
      <span>{label}</span>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </button>
  );
  const sep = <span role="separator" className="my-1 block h-px bg-line" />;
  const finalApp = r.source === "app" && r.state === "ready" && r.makeable && !r.draft && r.version !== null;
  const sendScan = (f: File | undefined) =>
    f &&
    start(async () => {
      const res = await uploadToOrder(
        orderId,
        f,
        drop ? { step: r.step, attachTo: drop, note: `${r.label}, signed` } : { step: r.step, note: `${r.label}, signed` },
      );
      if (res.error) window.alert(res.error);
      router.refresh();
    });

  const menuItems = (
    <>
      {print && (paperDone(r.state) || r.live || r.state === "draft" || !!issue) && (
        <>
          {item("View / Print", () => window.open(print.view, "_blank"))}
          {item("Download PDF", () => downloadHref(print.pdf))}
          {print.internal && item("Internal copy (PDF)", () => downloadHref(print.internal!), "all prices, costs")}
        </>
      )}
      {file && item("View the file", () => tools?.view(file))}
      {tools &&
        (paperDone(r.state) || r.live) &&
        (print || file) &&
        item(
          "Share…",
          () =>
            tools.open({
              kind: "share",
              files: print ? [] : file ? [file] : [],
              papers: print ? [{ key: r.key, label: [r.label, r.number].filter(Boolean).join(" ") }] : [],
            }),
          "WhatsApp, email",
        )}
      {canMake && finalApp && sep}
      {canMake &&
        finalApp &&
        item(
          "Make again",
          () =>
            start(async () => {
              const res = await paperAgainAction(orderId, r.kind as PaperKind, r.ref);
              if (!res.ok) return window.alert(res.message ?? "Something went wrong.");
              router.push(make!);
            }),
          `version ${(r.version ?? 1) + 1}, keeps ${r.version ?? 1}`,
        )}
      {canRecord &&
        r.source === "app" &&
        paperDone(r.state) &&
        item(r.doc?.file ? "Replace the signed scan" : "Attach the signed scan", () => document.getElementById(scanId)?.click())}
      {make && r.version !== null && item("Versions", () => router.push(make), String(r.version))}
      {recordable && r.state !== "else" && r.source === "upload" && item("Kept elsewhere instead", () => setOpen("elsewhere"))}
      {recordable && r.state === "else" && item("Upload it instead", () => setOpen("upload"))}
      {canMake && r.draft && r.paperId && (
        <>
          {sep}
          {item(
            "Delete the draft",
            () =>
              window.confirm(`Delete the draft of the ${r.label.toLowerCase()} (version ${r.version})?`) &&
              start(async () => {
                const res = await paperDeleteDraftAction(orderId, r.paperId!);
                if (!res.ok) window.alert(res.message ?? "Something went wrong.");
                router.refresh();
              }),
            "drafts only",
            true,
          )}
        </>
      )}
    </>
  );
  const fileCell =
    r.source === "app" && (r.version !== null || r.live) ? (
      <span className="inline-flex items-center gap-1 text-xs">
        <FileText className="size-3.5 text-muted" aria-hidden /> {r.live ? "live" : `version ${r.version}`}
        {file && <FileChip file={file} compact className="ml-1" />}
      </span>
    ) : file ? (
      <FileChip file={file} compact />
    ) : r.state === "else" ? (
      <span className="text-xs text-text-2">{r.doc?.keptWhere ?? ""}</span>
    ) : (
      <span className="text-xs text-muted">—</span>
    );

  return (
    <div
      role="row"
      data-drop-attach={canRecord && drop ? drop : undefined}
      data-drop-label={r.label}
      className={cn("border-b border-line px-2 last:border-b-0", open && "-mx-2 rounded-lg bg-primary-soft px-4")}
    >
      <div className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2.5 md:grid-cols-[28px_minmax(0,1.35fr)_minmax(0,1fr)_120px_minmax(0,1.25fr)_190px]">
        <span role="cell" className="row-span-2 self-start pt-0.5 md:row-span-1 md:self-center md:pt-0">
          <StateMark state={r.state} />
        </span>
        <span role="cell" className="min-w-0 font-medium">
          {make ? (
            <Link href={make} className="hover:underline">
              {r.label}
            </Link>
          ) : (
            r.label
          )}
          <span className="block text-xs font-normal text-muted md:hidden">
            {numberLine !== "—" ? `${numberLine} · ` : ""}
            {from.label.toLowerCase()}
            {r.state === "else" && r.doc?.keptWhere ? ` · ${r.doc.keptWhere}` : ""}
          </span>
        </span>
        <span role="cell" className="hidden truncate text-xs text-text-2 tabular md:block">
          {numberLine}
        </span>
        <span role="cell" className="hidden md:block">
          <Badge tone={from.tone}>{from.label}</Badge>
        </span>
        <span role="cell" className="hidden min-w-0 md:block">
          {fileCell}
        </span>
        <span role="cell" className="col-start-3 row-start-1 flex items-center justify-end gap-1 md:col-start-6">
          <span className="hidden items-center gap-1 sm:flex">{action}</span>
          {busy && <span className="text-xs text-muted">…</span>}
          <button
            ref={more}
            type="button"
            aria-label={`More for ${r.label}`}
            aria-haspopup="menu"
            aria-expanded={menu}
            className={buttonClass("ghost", "icon-xs")}
            onClick={() => setMenu((m) => !m)}
          >
            <MoreHorizontal aria-hidden />
          </button>
          {menu && (
            <FloatingMenu anchor={() => more.current} onClose={() => setMenu(false)} label={r.label} width={260}>
              {menuItems}
              {!print && !file && !recordable && !(canMake && r.draft) && (
                <p className="px-2.5 py-1.5 text-xs text-muted">Nothing to do here yet.</p>
              )}
            </FloatingMenu>
          )}
        </span>
        {action && <span className="col-start-2 flex flex-wrap gap-1.5 sm:hidden">{action}</span>}
      </div>
      <input
        id={scanId}
        type="file"
        hidden
        accept="application/pdf,image/*"
        onChange={(e) => (sendScan(e.target.files?.[0]), (e.target.value = ""))}
      />
      {open && (
        <div className="pb-3 md:pl-[40px]">
          <RecordForm
            r={{
              ...r,
              number: r.number ?? ((r.docKind === "bill_of_lading" || r.docKind === "airway_bill") && shipNumber ? shipNumber : null),
            }}
            today={today}
            mode={open}
            dealId={dealId}
            add={addAction}
            update={update}
            onDone={() => setOpen(null)}
            send={async (f) => {
              const res = await uploadToOrder(orderId, f, { step: r.step });
              return { id: res.sourceId, error: res.error };
            }}
            hint={
              open === "upload"
                ? `${r.docKind === "bill_of_lading" ? "B/L no. and date come from the shipment. " : ""}The file goes to the order's files too.`
                : undefined
            }
          />
        </div>
      )}
    </div>
  );
}
