"use client";

import { useState, type ReactNode } from "react";
import { FileText, Pencil, Plus } from "lucide-react";
import {
  BANK_CONTRACT_STATUS_LABEL,
  BANK_CONTRACT_STATUS_TONE,
  CLAIM_STATUS_TONE,
  DELIVERY_CONDITION_LABEL,
  DELIVERY_CONDITION_TONE,
  ORDER_DOCUMENT_STATUS_LABEL,
  ORDER_DOCUMENT_STATUS_TONE,
  PAYMENT_ROUTE_LABEL,
  SHIP_MODE_LABEL,
  SHIPMENT_STATUS_LABEL,
  SHIPMENT_STATUS_TONE,
  type BankStepKind,
  type PaymentRoute,
} from "@kebo/shared";
import { Badge, Button, DetailGrid, EmptyState, Tracker, type StepState } from "@kebo/ui";
import { ConfirmSubmit } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";
import type { BankContract, BankStepView, ClaimView, DeliveryView, FlowDocument, SatCheckView, ShipmentView } from "@/lib/types-flow";
import {
  BankContractForm,
  BankStepForm,
  ClaimForm,
  ClaimUpdateForm,
  DateForm,
  DeliveryForm,
  DocumentForm,
  RemoveButton,
  RouteForm,
  SatEditor,
  SatSignOffForm,
  ShipmentForm,
} from "./flow-forms";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** "05 Feb 2027" without pulling the server's formatter into the browser bundle. */
const day = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
};
const short = (iso: string | null | undefined) => {
  if (!iso) return null;
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
};

/** Done / now / later for a list of dated steps: the first not done is the current one; a late one shows in amber. */
function states<T>(items: T[], done: (t: T) => boolean, late?: (t: T) => boolean): StepState[] {
  let seen = false;
  return items.map((t) => {
    if (done(t)) return "done";
    if (!seen) {
      seen = true;
      return late?.(t) ? "attention" : "current";
    }
    return late?.(t) ? "attention" : "todo";
  });
}

/* ---------------------------------------------------------------- payment route */

export function RoutePanel({
  routeAction,
  contractAction,
  route,
  contract,
  bankRoutes,
  currency,
  canEdit,
}: {
  routeAction: Action;
  contractAction: Action;
  route: PaymentRoute | null;
  contract: BankContract | null;
  bankRoutes: boolean;
  currency: string;
  canEdit: boolean;
}) {
  const [editRoute, setEditRoute] = useState(false);
  const [editContract, setEditContract] = useState(false);
  const bank = route === "bank_contract" || route === "letter_of_credit";
  const lc = route === "letter_of_credit";
  if (!route || editRoute)
    return canEdit ? (
      <div className="flex flex-col gap-2">
        {!route && <p className="text-sm text-text-2">Choose once per order: it decides the papers and the bank steps after shipping.</p>}
        <RouteForm action={routeAction} route={route} bankRoutes={bankRoutes} onDone={route ? () => setEditRoute(false) : undefined} />
      </div>
    ) : (
      <p className="text-sm text-muted">Not chosen yet.</p>
    );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{PAYMENT_ROUTE_LABEL[route]}</span>
        {canEdit && (
          <Button size="xs" variant="ghost" onClick={() => setEditRoute(true)}>
            <Pencil aria-hidden /> Change
          </Button>
        )}
      </div>
      {bank &&
        bankRoutes &&
        (editContract ? (
          <BankContractForm action={contractAction} contract={contract} lc={lc} currency={currency} onDone={() => setEditContract(false)} />
        ) : contract ? (
          <div className="flex flex-col gap-2">
            <DetailGrid
              onEdit={canEdit ? () => setEditContract(true) : undefined}
              items={[
                { label: lc ? "LC number" : "Contract no.", value: contract.number, warn: "Add the number" },
                { label: "Status", value: <Badge tone={BANK_CONTRACT_STATUS_TONE[contract.status]}>{BANK_CONTRACT_STATUS_LABEL[contract.status]}</Badge> },
                { label: "Amount", value: contract.amount !== null ? `${contract.currency ?? ""} ${contract.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : null },
                { label: "Customer's bank", value: contract.customerBank },
                { label: "Our bank", value: contract.ourBank },
                { label: "Opened", value: day(contract.openedOn) },
                { label: "Ship by", value: day(contract.latestShipOn), hideEmpty: !lc },
                { label: "Expires", value: day(contract.expiresOn), hideEmpty: !lc },
              ]}
            />
            {contract.note && <p className="text-sm text-text-2">{contract.note}</p>}
          </div>
        ) : canEdit ? (
          <div>
            <Button size="sm" variant="primary" onClick={() => setEditContract(true)}>
              <Plus aria-hidden /> Add the {lc ? "LC" : "bank contract"}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted">The {lc ? "LC" : "contract"} is not recorded yet.</p>
        ))}
    </div>
  );
}

/* ---------------------------------------------------------------- factory order */

export function FactoryOrderPanel({ action, orderedOn, readyOn, factories, today, canEdit }: { action: Action; orderedOn: string | null; readyOn: string | null; factories: { id: string; name: string }[]; today: string; canEdit: boolean }) {
  const [edit, setEdit] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <DetailGrid
        items={[
          { label: factories.length > 1 ? "Factories" : "Factory", value: factories.map((f) => f.name).join(", ") || null, warn: "No factory on the lines" },
          { label: "Ordered on", value: day(orderedOn), warn: "Not ordered yet" },
          { label: "Ready (factory says)", value: day(readyOn) },
        ]}
      />
      {canEdit &&
        (edit || !orderedOn ? (
          <DateForm
            action={action}
            name="factoryOrderedOn"
            label="Ordered from the factory on"
            hint="The day we confirmed the order (PO or signed proforma)"
            value={orderedOn}
            max={today}
            save={orderedOn ? "Save" : "Mark as ordered"}
            onDone={orderedOn ? () => setEdit(false) : undefined}
          />
        ) : (
          <div>
            <Button size="xs" variant="ghost" onClick={() => setEdit(true)}>
              <Pencil aria-hidden /> Change the date
            </Button>
          </div>
        ))}
    </div>
  );
}

/* ---------------------------------------------------------------- shipping */

export function ShipmentsPanel({
  addAction,
  updateActions,
  removeActions,
  shipments,
  defaults,
  today,
  canEdit,
}: {
  addAction: Action;
  updateActions: Record<string, Action>;
  removeActions: Record<string, Action>;
  shipments: ShipmentView[];
  defaults: Partial<ShipmentView>;
  today: string;
  canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-4">
      {!shipments.length && !adding && (
        <EmptyState
          title="Not booked yet"
          description="When the goods are nearly ready, book the space with the forwarder and add the shipment here: the way, the ports, the container and the dates."
          action={
            canEdit ? (
              <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
                <Plus aria-hidden /> Add the shipment
              </Button>
            ) : undefined
          }
        />
      )}
      {shipments.map((s, i) => {
        if (editing === s.id) return <ShipmentForm key={s.id} action={updateActions[s.id]!} shipment={s} today={today} onDone={() => setEditing(null)} />;
        const air = s.mode === "air";
        const reached = ["loaded", "departed", "arrived", "cleared"].indexOf(s.status);
        const tracker: { key: string; title: string; sub?: string; done: boolean }[] = [
          { key: "booked", title: "Booked with the forwarder", sub: [s.forwarder, s.bookingNo].filter(Boolean).join(" · ") || undefined, done: s.status !== "planned" },
          { key: "loaded", title: air ? "Handed to the airline" : "Packed and loaded", sub: s.containerNo ? `${s.containerType ?? "Container"} ${s.containerNo}` : undefined, done: reached >= 0 },
          { key: "departed", title: air ? "Flown" : "Sailed", sub: [s.blNo ? `${air ? "AWB" : "B/L"} ${s.blNo}` : null, s.departedOn ? day(s.departedOn) : s.etd ? `ETD ${day(s.etd)}` : null].filter(Boolean).join(" · ") || undefined, done: reached >= 1 },
          { key: "arrived", title: `Arrives${s.portOfDischarge ? ` at ${s.portOfDischarge}` : ""}`, sub: s.arrivedOn ? `arrived ${day(s.arrivedOn)}` : s.eta ? `ETA ${day(s.eta)}` : undefined, done: reached >= 2 },
          { key: "cleared", title: "Customs cleared", done: reached >= 3 },
        ];
        const st = states(tracker, (t) => t.done);
        return (
          <section key={s.id} className="flex flex-col gap-3" aria-label={`Shipment ${i + 1}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                {shipments.length > 1 && <span>Shipment {i + 1} of {shipments.length} ·</span>}
                By {SHIP_MODE_LABEL[s.mode].toLowerCase()}
                {(s.portOfLoading || s.portOfDischarge) && <span className="font-normal text-text-2">· {s.portOfLoading ?? "?"} → {s.portOfDischarge ?? "?"}</span>}
                <Badge tone={SHIPMENT_STATUS_TONE[s.status]}>{SHIPMENT_STATUS_LABEL[s.status]}</Badge>
              </p>
              {canEdit && (
                <span className="flex gap-1">
                  <Button size="xs" variant="ghost" onClick={() => setEditing(s.id)}>
                    <Pencil aria-hidden /> Edit
                  </Button>
                  <RemoveButton action={removeActions[s.id]!} what="this shipment" />
                </span>
              )}
            </div>
            <DetailGrid
              onEdit={canEdit ? () => setEditing(s.id) : undefined}
              items={[
                { label: "Forwarder", value: s.forwarder },
                { label: air ? "AWB" : "Bill of lading", value: s.blNo, warn: reached >= 1 ? "Add the number" : undefined },
                { label: "Container", value: [s.containerType, s.containerNo].filter(Boolean).join(" · ") || null, hideEmpty: air },
                { label: "Leaves (ETD)", value: day(s.etd) },
                { label: "Arrives (ETA)", value: day(s.eta) },
                { label: "Vessel", value: s.vessel, hideEmpty: true },
              ]}
            />
            <Tracker label={`Shipment ${i + 1} progress`} steps={tracker.map((t, j) => ({ key: t.key, title: t.title, sub: t.sub, state: st[j]! }))} />
            {s.note && <p className="text-sm text-text-2">{s.note}</p>}
          </section>
        );
      })}
      {adding && <ShipmentForm action={addAction} defaults={defaults} today={today} onDone={() => setAdding(false)} />}
      {canEdit && shipments.length > 0 && !adding && (
        <div>
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            <Plus aria-hidden /> Add another shipment
          </Button>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- the document set and the bank chain */

export function PaperSetPanel({
  addAction,
  updateActions,
  removeActions,
  set,
  files,
  shipments,
  printButtons,
  canEdit,
}: {
  addAction: Action;
  updateActions: Record<string, Action>;
  removeActions: Record<string, Action>;
  set: FlowDocument[];
  files: { id: string; name: string; href: string }[];
  shipments: { id: string; label: string }[];
  /** The order's own View / PDF buttons for the papers the app makes, unchanged. */
  printButtons: Partial<Record<"proforma" | "packing-list", ReactNode>>;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const fileHref = (id: string) => files.find((f) => f.id === id)?.href;
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
        {set.map((d, i) => {
          const key = d.id ?? `need-${d.kind}`;
          if (editing === key)
            return (
              <li key={key} className="p-2">
                <DocumentForm
                  action={d.id ? updateActions[d.id]! : addAction}
                  doc={d.id ? d : undefined}
                  kind={d.id ? undefined : d.kind}
                  files={files}
                  shipments={shipments}
                  onDone={() => setEditing(null)}
                />
              </li>
            );
          const href = d.file ? fileHref(d.file.id) : undefined;
          return (
            <li key={key + i} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
              <span className="flex min-w-0 flex-col">
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <FileText className="size-4 shrink-0 text-muted" aria-hidden /> {d.label}
                  {!d.required && <span className="text-xs font-normal text-muted">extra</span>}
                </span>
                <span className="ml-6 text-xs text-muted">
                  {[d.number, d.issuedOn ? `issued ${day(d.issuedOn)}` : null, d.printable && !d.id ? "made by the app" : null, d.note].filter(Boolean).join(" · ") || " "}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <Badge tone={ORDER_DOCUMENT_STATUS_TONE[d.status]}>{ORDER_DOCUMENT_STATUS_LABEL[d.status]}</Badge>
                {d.printable && !d.id && printButtons[d.printable]}
                {d.file && href && (
                  <a href={href} className="max-w-48 truncate text-xs font-medium text-primary hover:underline">
                    {d.file.name}
                  </a>
                )}
                {canEdit && !(d.printable && !d.id) && (
                  <Button size="xs" variant={d.status === "ready" ? "ghost" : "secondary"} onClick={() => setEditing(key)}>
                    {d.id ? <Pencil aria-hidden /> : <Plus aria-hidden />} {d.id ? "Edit" : "Record"}
                  </Button>
                )}
                {canEdit && d.id && <RemoveButton action={removeActions[d.id]!} what={`the ${d.label.toLowerCase()}`} />}
              </span>
            </li>
          );
        })}
      </ul>
      {canEdit &&
        (adding ? (
          <DocumentForm action={addAction} files={files} shipments={shipments} onDone={() => setAdding(false)} />
        ) : (
          <div>
            <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
              <Plus aria-hidden /> Add another document
            </Button>
          </div>
        ))}
    </div>
  );
}

export function BankChainPanel({
  stepActions,
  clearActions,
  steps,
  today,
  canEdit,
}: {
  stepActions: Record<string, Action>;
  clearActions: Record<string, Action>;
  steps: BankStepView[];
  today: string;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState<BankStepKind | null>(null);
  const st = states(steps, (s) => !!s.doneOn);
  return (
    <Tracker
      label="Documents through the banks"
      steps={steps.map((s, i) => ({
        key: s.step,
        title: s.label,
        sub: (
          <>
            {[s.doneOn ? day(s.doneOn) : null, s.courier, s.reference, s.note].filter(Boolean).join(" · ")}
            {open === s.step && <BankStepForm action={stepActions[s.step]!} step={s} today={today} onDone={() => setOpen(null)} />}
          </>
        ),
        state: st[i]!,
        side: canEdit ? (
          s.doneOn ? (
            <ActionForm action={clearActions[s.step]!} showSuccess={false}>
              <ConfirmSubmit size="xs" variant="ghost" pendingText="…" message={`Undo "${s.label}"?`}>
                Undo
              </ConfirmSubmit>
            </ActionForm>
          ) : open !== s.step ? (
            <Button size="xs" variant={st[i] === "current" ? "primary" : "ghost"} onClick={() => setOpen(s.step)}>
              Mark done
            </Button>
          ) : null
        ) : s.doneOn ? (
          <span className="text-xs text-muted tabular">{short(s.doneOn)}</span>
        ) : null,
      }))}
    />
  );
}

/* ---------------------------------------------------------------- delivery, SAT, claims */

export function DeliveryPanel({
  action,
  d,
  people,
  arrivedOn,
  today,
  canEdit,
}: {
  action: Action;
  d: DeliveryView;
  people: { id: string; name: string }[];
  /** When the last shipment arrived (from Shipping). */
  arrivedOn: string | null;
  today: string;
  canEdit: boolean;
}) {
  const [edit, setEdit] = useState(false);
  const [signing, setSigning] = useState(false);
  const satReady = d.sat.length > 0 && d.sat.every((c) => c.result === "pass" || c.result === "not_applicable");
  const tracker = [
    { key: "arrived", title: "Arrived", sub: day(arrivedOn) ?? "not yet", done: !!arrivedOn || !!d.deliveredOn },
    { key: "delivered", title: "Delivered to site", sub: day(d.deliveredOn) ?? undefined, done: !!d.deliveredOn },
    {
      key: "condition",
      title: "Condition checked",
      sub: d.condition ? [DELIVERY_CONDITION_LABEL[d.condition], d.note].filter(Boolean).join(" · ") : undefined,
      done: !!d.condition,
    },
    {
      key: "sat",
      title: "Site acceptance test (SAT)",
      sub: d.satDoneOn
        ? `passed ${day(d.satDoneOn)}${d.satSignedBy ? ` · signed by ${d.satSignedBy}` : ""}`
        : [d.satPlannedOn ? `planned ${day(d.satPlannedOn)}` : null, d.satEngineer?.name].filter(Boolean).join(" · ") || undefined,
      done: !!d.satDoneOn,
    },
  ];
  const st = states(tracker, (t) => t.done);
  return (
    <div className="flex flex-col gap-3">
      {edit ? (
        <DeliveryForm action={action} d={d} people={people} today={today} onDone={() => setEdit(false)} />
      ) : (
        <DetailGrid
          onEdit={canEdit ? () => setEdit(true) : undefined}
          items={[
            { label: "Delivered on", value: day(d.deliveredOn) },
            { label: "Condition", value: d.condition ? <Badge tone={DELIVERY_CONDITION_TONE[d.condition]}>{DELIVERY_CONDITION_LABEL[d.condition]}</Badge> : null },
            { label: "Our engineer", value: d.satEngineer?.name ?? null },
            { label: "SAT planned", value: day(d.satPlannedOn) },
            { label: "SAT passed", value: day(d.satDoneOn), hideEmpty: true },
            { label: "Signed by", value: d.satSignedBy, hideEmpty: true },
          ]}
        />
      )}
      <Tracker
        label="Delivery and SAT"
        steps={tracker.map((t, i) => ({
          key: t.key,
          title: t.title,
          sub: t.sub,
          state: st[i]!,
          side:
            t.key === "sat" && canEdit && !d.satDoneOn && d.deliveredOn && !signing ? (
              <Button size="xs" variant={satReady ? "primary" : "ghost"} disabled={!satReady} title={satReady ? undefined : "Every SAT point must pass (or be N/A) first"} onClick={() => setSigning(true)}>
                Sign off
              </Button>
            ) : null,
        }))}
      />
      {signing && <SatSignOffForm action={action} today={today} onDone={() => setSigning(false)} />}
      {d.satDoneOn && canEdit && (
        <ActionForm action={action} showSuccess={false}>
          <input type="hidden" name="satDoneOn" value="" />
          <ConfirmSubmit size="xs" variant="ghost" pendingText="…" message="Reopen the SAT? The sign-off date is cleared.">
            Reopen the SAT
          </ConfirmSubmit>
        </ActionForm>
      )}
    </div>
  );
}

export function SatPanel({ action, checks, suggested, locked, canEdit }: { action: Action; checks: SatCheckView[]; suggested: string[]; locked: boolean; canEdit: boolean }) {
  if (!canEdit && !checks.length) return <p className="text-sm text-muted">No SAT checklist yet.</p>;
  return <SatEditor action={action} checks={checks} suggested={canEdit ? suggested : []} locked={locked || !canEdit} />;
}

export function ClaimsPanel({ addAction, updateActions, claims, today, canEdit }: { addAction: Action; updateActions: Record<string, Action>; claims: ClaimView[]; today: string; canEdit: boolean }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      {!claims.length && !adding && <p className="text-sm text-muted">No claims. Open one if something arrived damaged, missing or faulty.</p>}
      {claims.length > 0 && (
        <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
          {claims.map((c) => (
            <li key={c.id} className="flex flex-col gap-1 px-3 py-2.5">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {c.title} <Badge tone={CLAIM_STATUS_TONE[c.status]}>{c.statusLabel}</Badge>
                </span>
                <span className="flex items-center gap-2 text-xs text-muted">
                  {day(c.openedOn)}
                  {c.resolvedOn && ` → ${day(c.resolvedOn)}`}
                  {canEdit && editing !== c.id && (
                    <Button size="xs" variant="ghost" onClick={() => setEditing(c.id)}>
                      <Pencil aria-hidden /> Update
                    </Button>
                  )}
                </span>
              </span>
              {c.detail && <span className="text-sm text-text-2">{c.detail}</span>}
              {c.resolution && <span className="text-sm">Settled: {c.resolution}</span>}
              {editing === c.id && <ClaimUpdateForm action={updateActions[c.id]!} claim={c} onDone={() => setEditing(null)} />}
            </li>
          ))}
        </ul>
      )}
      {canEdit &&
        (adding ? (
          <ClaimForm action={addAction} today={today} onDone={() => setAdding(false)} />
        ) : (
          <div>
            <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
              <Plus aria-hidden /> Open a claim
            </Button>
          </div>
        ))}
    </div>
  );
}
