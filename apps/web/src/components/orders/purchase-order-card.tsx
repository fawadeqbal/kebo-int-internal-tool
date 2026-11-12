"use client";

import { Mail, Printer } from "lucide-react";
import { Alert, Button, ButtonLink, Card, CardBody, CardHeader, Field, Input, RefCode, Select, StatusBadge, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import Link from "next/link";
import { ActionForm } from "@/components/common/action-form";
import { PanelActions, PanelBody, useClosePanel } from "@/components/common/panel";
import { PanelButton } from "@/components/orders/step-view";
import type { ActionState } from "@/lib/actions";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

export interface PurchaseOrderView {
  id: string;
  number: string;
  supplier: { id: string; name: string };
  lines: number;
  currency: string | null;
  total: string | null;
  readyOn: string | null;
  sentOn: string | null;
  sentBy: { id: string; name: string } | null;
  supplierRef: string | null;
  sentEarlyReason: string | null;
}

const HOW = ["Email", "WeChat", "WhatsApp", "By hand"];

/**
 * A purchase order on the order's Factory tab (board OrderFactory): its number, supplier, total, ready date,
 * their order no. and whether it was sent; View / print PO and Send to supplier.
 */
export function PurchaseOrderCard({
  po,
  total,
  ready,
  sent,
  printHref,
  send,
  deposit,
  today,
}: {
  po: PurchaseOrderView;
  /** "CNY 292,860.00" (people who see factory prices). */
  total: string | null;
  ready: string | null;
  sent: string | null;
  printHref: string;
  /** Null when this person cannot send it (or it is sent). */
  send: Action | null;
  deposit: { verified: boolean; text: string };
  today: string;
}) {
  return (
    <Card>
      <CardHeader
        title="Purchase order"
        actions={
          <StatusBadge meaning={po.sentOn ? (po.sentEarlyReason ? "warn" : "ok") : "neutral"}>{po.sentOn ? (po.sentEarlyReason ? "Sent before deposit" : "Sent") : "Draft"}</StatusBadge>
        }
      />
      <CardBody className="flex flex-col gap-4">
        <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted">Purchase order</dt>
            <dd>
              <RefCode>{po.number}</RefCode>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Supplier</dt>
            <dd>
              <Link href={`/factories/${po.supplier.id}`} className="text-primary underline-offset-2 hover:underline">
                {po.supplier.name}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Currency</dt>
            <dd>{po.currency ?? "—"}</dd>
          </div>
          {total && (
            <div>
              <dt className="text-xs text-muted">Total</dt>
              <dd className="font-bold tabular">{total}</dd>
            </div>
          )}
          <div>
            <dt className="text-xs text-muted">Ready by</dt>
            <dd>{ready ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Their order no.</dt>
            <dd>{po.supplierRef ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Sent</dt>
            <dd>
              {sent ? (
                <>
                  {sent}
                  {po.sentBy && <span className="text-muted"> · {po.sentBy.name}</span>}
                </>
              ) : (
                <StatusBadge meaning="warn">Not sent</StatusBadge>
              )}
            </dd>
          </div>
          {po.sentEarlyReason && (
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted">Sent before the deposit was verified</dt>
              <dd>{po.sentEarlyReason}</dd>
            </div>
          )}
        </dl>
        <div className="flex flex-wrap gap-2.5 border-t border-line pt-4">
          <ButtonLink href={printHref}>
            <Printer aria-hidden /> View / print PO
          </ButtonLink>
          {send && (
            <PanelButton
              variant="primary"
              icon={<Mail aria-hidden />}
              label="Send to supplier"
              title={`Send ${po.number} to ${po.supplier.name}`}
              description={[total, ready ? `ready by ${ready}` : null].filter(Boolean).join(" · ") || undefined}
              panelClassName="md:w-[760px]"
              body={<SendForm action={send} deposit={deposit} today={today} supplierRef={po.supplierRef} />}
            />
          )}
        </div>
      </CardBody>
    </Card>
  );
}

/** "Send PO-2026-0044 to …" (board POSendEarly): the day, their order no., how; before the deposit is verified, why. */
function SendForm({ action, deposit, today, supplierRef }: { action: Action; deposit: { verified: boolean; text: string }; today: string; supplierRef: string | null }) {
  const close = useClosePanel();
  return (
    <ActionForm action={action} onDone={close} className="flex min-h-0 flex-1 flex-col">
      {(s) => (
        <>
          <PanelBody className="flex flex-col gap-4">
            {!deposit.verified && (
              <Alert tone="warning">
                <strong>Deposit not verified.</strong> {deposit.text}
              </Alert>
            )}
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Sent on" htmlFor="po-sent" required error={s.errors?.sentOn}>
                <Input id="po-sent" name="sentOn" type="date" max={today} defaultValue={s.values?.sentOn ?? today} />
              </Field>
              <Field label="Their order no." htmlFor="po-ref" hint="if the factory gives one" error={s.errors?.supplierRef}>
                <Input id="po-ref" name="supplierRef" maxLength={60} defaultValue={s.values?.supplierRef ?? supplierRef ?? ""} />
              </Field>
              <Field label="Send by" htmlFor="po-how">
                <Select id="po-how" name="how" defaultValue={s.values?.how ?? HOW[0]}>
                  {HOW.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {!deposit.verified && (
              <Field
                label="Why send it before the deposit is verified?"
                htmlFor="po-reason"
                required
                hint="The reason is kept on the purchase order and in the audit log."
                error={s.errors?.reason}
              >
                <Textarea id="po-reason" name="reason" rows={3} maxLength={300} defaultValue={s.values?.reason ?? ""} />
              </Field>
            )}
          </PanelBody>
          <PanelActions className="static mx-0 mb-0 justify-end">
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <SubmitButton pendingText="Saving…">
              <Mail aria-hidden /> Send purchase order
            </SubmitButton>
          </PanelActions>
        </>
      )}
    </ActionForm>
  );
}
