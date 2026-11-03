"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";
import { Alert, Button, Card, CardHeader, cn } from "@kebo/ui";
import type { ActionState } from "@/lib/actions";
import { useIsPhone } from "@/components/common/floating";
import { LightForm, sendTo, TapButton, type LightChip, type LightField, type LightTap } from "./light-form";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

export interface BankStepLine {
  step: string;
  label: string;
  /** Done: its date (shown as "12 Jan"). */
  done: string | null;
  /** Under the name: the bank, the tracking number, "starts the 90 days", "records the payment". */
  sub: string | null;
}

/**
 * The current step's button: one tap, a small form (the courier's tracking
 * no.), or a form of its own (record the payment). A form opens as a band
 * under the whole tracker (full screen on a phone).
 */
export type BankStepTool =
  | { kind: "tap"; tap: LightTap }
  | { kind: "light"; label: string; note?: string; action: Action; fields: LightField[]; chips?: LightChip[] }
  | { kind: "form"; label: string; note?: string; form: ReactNode };

/** Inside a bank step's band: close it, show an error above the tracker, and whether it is the phone's full screen. */
interface Band {
  close: () => void;
  error: (message: string) => void;
  phone: boolean;
}
const BandContext = createContext<Band>({ close: () => {}, error: () => {}, phone: false });
/** A form in a bank step's band (Money reached us): its Cancel and its done. */
export const useBankBand = () => useContext(BandContext);

/**
 * The band a step's button opens: under the whole tracker on a computer
 * ("6 · Money reached us · LC/HBL/2026/118" and ×, the form's body, its
 * footer), the whole screen on a phone with the action pinned at the bottom.
 */
function StepBand({
  number,
  of,
  label,
  reference,
  note,
  small,
  onClose,
  onError,
  children,
}: {
  number: number;
  of: number;
  label: string;
  reference: string | null;
  note?: string;
  small?: boolean;
  onClose: () => void;
  onError: (m: string) => void;
  children: ReactNode;
}) {
  const id = useId();
  const phone = useIsPhone();
  const box = useRef<HTMLElement>(null);
  const head = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  useEffect(() => {
    if (!phone) {
      box.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      head.current?.focus({ preventScroll: true });
      return;
    }
    head.current?.focus({ preventScroll: true });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [phone]);
  const band: Band = { close: onClose, error: onError, phone };
  const close = (
    <Button size="icon-sm" variant="ghost" aria-label="Close the form" onClick={onClose}>
      <X aria-hidden />
    </Button>
  );
  if (phone)
    return createPortal(
      <section role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} className="fixed inset-0 z-[80] flex flex-col bg-surface">
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 id={`${id}-t`} ref={head} tabIndex={-1} className="text-base font-semibold outline-none">
              {label}
            </h2>
            <p className="text-xs text-text-2">{[reference, `step ${number} of ${of}`].filter(Boolean).join(" · ")}</p>
          </div>
          {close}
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <BandContext.Provider value={band}>{children}</BandContext.Provider>
        </div>
      </section>,
      document.body,
    );
  return (
    <section
      ref={box}
      aria-labelledby={`${id}-t`}
      className="scroll-mb-4 overflow-hidden rounded-xl border border-primary/70 bg-surface shadow-card ring-1 ring-primary/15 animate-in"
    >
      <div className={cn("flex items-start justify-between gap-3 border-b border-line px-4", small ? "py-2.5" : "py-3")}>
        <div className="min-w-0">
          <h3 id={`${id}-t`} ref={head} tabIndex={-1} className={cn("font-semibold outline-none", small ? "text-sm" : "text-base")}>
            {[`${number} · ${label}`, reference].filter(Boolean).join(" · ")}
          </h3>
          {note && <p className="text-xs text-text-2">{note}</p>}
        </div>
        {close}
      </div>
      <BandContext.Provider value={band}>{children}</BandContext.Provider>
    </section>
  );
}

/**
 * Documents › Through the banks: the route's bank steps, each once, as a
 * tracker; only today's step (the first not done) has its button, done steps
 * show their date. A step's form opens as a band under the whole tracker, so
 * the tracker stays readable. On a phone: a list of the current step and the
 * next, and "+ n more"; the form takes the whole screen.
 */
export function BankTracker({
  title,
  description,
  steps,
  tool,
  dealId,
  reference,
}: {
  title: string;
  description: string;
  steps: BankStepLine[];
  tool: BankStepTool | null;
  dealId: string;
  /** The LC or bank contract no., in the form's heading. */
  reference?: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const at = steps.findIndex((s) => !s.done);
  const close = () => {
    setForm(false);
    opener.current?.focus({ preventScroll: true });
  };
  const button = (primary: boolean) =>
    !tool ? null : tool.kind === "tap" ? (
      <TapButton tap={tool.tap} primary={primary} onError={setError} />
    ) : (
      <Button
        size="xs"
        variant={primary && !form ? "primary" : "secondary"}
        aria-expanded={form}
        onClick={(e) => {
          opener.current = e.currentTarget;
          setError(null);
          setForm((f) => !f);
        }}
      >
        {tool.label}
      </Button>
    );
  const current = at >= 0 ? steps[at]! : null;
  const band =
    form && current && tool && tool.kind !== "tap" ? (
      <StepBand
        number={at + 1}
        of={steps.length}
        label={current.label}
        reference={reference ?? null}
        note={tool.note}
        small={tool.kind === "light"}
        onClose={close}
        onError={setError}
      >
        {tool.kind === "light" ? (
          <LightForm
            band
            fields={tool.fields}
            chips={tool.chips}
            dealId={dealId}
            fileNote={current.label}
            onSubmit={sendTo(tool.action)}
            onDone={close}
          />
        ) : (
          tool.form
        )}
      </StepBand>
    ) : null;
  const rest = at < 0 ? 0 : steps.length - at - 2;
  return (
    <Card data-target="bank" data-target-card="">
      <CardHeader title={title} description={description} />
      <div className="flex flex-col gap-3 px-4 py-4">
        {error && <Alert tone="error">{error}</Alert>}
        {/* A computer: the whole route, left to right. */}
        <ol className="hidden gap-3 sm:flex" aria-label={title}>
          {steps.map((s, i) => {
            const now = i === at;
            return (
              <li
                key={s.step}
                data-target={`bank.${s.step}`}
                className="-m-1 flex min-w-0 flex-1 flex-col gap-1.5 p-1"
                aria-current={now ? "step" : undefined}
              >
                <span className="flex items-center">
                  <span
                    className={cn(
                      "grid size-[26px] shrink-0 place-items-center rounded-full text-xs font-bold",
                      s.done
                        ? "bg-ok text-white"
                        : now
                          ? "bg-primary text-primary-fg ring-4 ring-primary/15"
                          : "border-[1.5px] border-line-strong bg-surface text-muted",
                    )}
                  >
                    {s.done ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : i + 1}
                  </span>
                  <span
                    className={cn(
                      "ml-1.5 h-0.5 flex-1",
                      s.done ? "bg-ok" : now ? "bg-primary" : "bg-line-strong",
                      i === steps.length - 1 && "invisible",
                    )}
                  />
                </span>
                <b
                  className={cn(
                    "text-[13px] leading-snug",
                    now ? "font-semibold text-primary" : s.done ? "font-semibold" : "font-medium text-text-2",
                  )}
                >
                  {s.label}
                </b>
                {(s.done || s.sub) && <span className="text-xs text-text-2">{[s.done, s.sub].filter(Boolean).join(" · ")}</span>}
                {now && <span className="flex flex-wrap">{button(true)}</span>}
              </li>
            );
          })}
        </ol>
        {/* A phone: done so far, today's step with its button, the next one, and how many more. */}
        <ol className="flex flex-col divide-y divide-line sm:hidden">
          {at > 0 && (
            <li className="py-2 text-xs text-muted">
              {at} done · last: {steps[at - 1]!.label} {steps[at - 1]!.done}
            </li>
          )}
          {(at < 0 ? steps.slice(-1) : steps.slice(at, at + 2)).map((s, j) => {
            const now = at >= 0 && j === 0;
            return (
              <li key={s.step} data-target={`bank.${s.step}`} className="flex items-start gap-2.5 py-2.5">
                <span
                  className={cn(
                    "mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full",
                    s.done ? "bg-ok text-white" : "border-[1.5px] border-line-strong bg-surface",
                  )}
                  aria-hidden
                >
                  {s.done && <Check className="size-3" strokeWidth={3.5} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {steps.indexOf(s) + 1} · {s.label}
                  </span>
                  <span className="block text-xs text-muted">{s.done ? `done ${s.done}` : now ? s.sub : "next"}</span>
                  {now && <span className="mt-1.5 flex flex-wrap">{button(true)}</span>}
                </span>
              </li>
            );
          })}
          {rest > 0 && <li className="py-2 text-xs text-muted">+ {rest} more steps</li>}
        </ol>
        {/* The step's form: a band under the whole tracker (the whole screen on a phone). */}
        {band}
        {at < 0 && <p className="text-xs text-ok">Every bank step is done.</p>}
      </div>
    </Card>
  );
}
