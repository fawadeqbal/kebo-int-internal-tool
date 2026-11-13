"use client";

import { CLAIM_BEARER_LABEL, CLAIM_STATUS_TONE, type ClaimBearer } from "@kebo/shared";
import { Badge, Field, Input, Table, Td, Th, THead, Tr } from "@kebo/ui";
import type { ActionState } from "@/lib/actions";
import type { ClaimView } from "@/lib/types-flow";
import { date, money } from "@/lib/format";
import { ClaimForm, ClaimUpdateForm } from "@/components/orders/flow-forms";
import { FormWindow } from "./form-window";
import { FieldRow, SectionWindow } from "./section-window";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** "All delivered OK": every goods line delivered in full and in good condition, on a day. */
export function AllDeliveredWindow({ sub, action, today, lines }: { sub: string; action: Action; today: string; lines: number }) {
  return (
    <SectionWindow
      button={{ label: "All delivered OK", kind: "main" }}
      title="Delivery"
      sub={sub}
      action={action}
      submit="All delivered OK"
      whats={[`${lines === 1 ? "The line is" : `All ${lines} lines are`} marked delivered in full, in good condition.`, "A line that came short or damaged is changed in “Edit lines”.", "The order becomes “Delivered”."]}
    >
      {(s) => (
        <Field label="Delivered on" htmlFor="dl-on" error={s.errors?.deliveredOn}>
          <Input id="dl-on" name="deliveredOn" type="date" max={today} defaultValue={s.values?.deliveredOn ?? today} />
        </Field>
      )}
    </SectionWindow>
  );
}

/** "Sign off the SAT": every point passed, signed for the customer on a day. */
export function SatSignWindow({ sub, action, today, signedBy, points }: { sub: string; action: Action; today: string; signedBy: string | null; points: number }) {
  return (
    <SectionWindow
      button={{ label: "Sign off", kind: "main" }}
      title="Sign off the SAT"
      sub={sub}
      action={action}
      submit="All passed, sign off"
      whats={[points ? `All ${points} points are marked passed.` : "The usual points are added and marked passed.", "The warranty starts that day."]}
    >
      {(s) => (
        <FieldRow>
          <Field label="Signed for the customer by" htmlFor="sat-by" error={s.errors?.satSignedBy}>
            <Input id="sat-by" name="satSignedBy" maxLength={120} required placeholder="e.g. Mr. Imran, QA head" defaultValue={s.values?.satSignedBy ?? signedBy ?? ""} />
          </Field>
          <Field label="Passed on" htmlFor="sat-on" error={s.errors?.satDoneOn}>
            <Input id="sat-on" name="satDoneOn" type="date" max={today} defaultValue={s.values?.satDoneOn ?? today} />
          </Field>
        </FieldRow>
      )}
    </SectionWindow>
  );
}

/** "Add a claim": what is wrong, since when, what it is worth and who pays. */
export function ClaimAddWindow({ sub, action, today, main }: { sub: string; action: Action; today: string; main?: boolean }) {
  return (
    <FormWindow button={{ label: "Add a claim", kind: main ? "main" : "plain" }} title="A claim" sub={sub} size="md">
      {(close) => <ClaimForm action={action} today={today} onDone={close} />}
    </FormWindow>
  );
}

/** The order's claims as a table; a claim opens in its window. */
export function ClaimsTable({ claims, currency, sub, actions }: { claims: ClaimView[]; currency: string; sub: string; /** By claim id; none: read only. */ actions: Record<string, Action> | null }) {
  return (
    <Table>
      <THead>
        <tr>
          <Th>What is wrong</Th>
          <Th>Opened</Th>
          <Th className="text-right">Amount</Th>
          <Th>Who pays</Th>
          <Th>Status</Th>
          <Th />
        </tr>
      </THead>
      <tbody>
        {claims.map((c) => (
          <Tr key={c.id}>
            <Td>
              <span className="font-semibold">{c.title}</span>
              {c.detail && <span className="block text-xs text-text-2">{c.detail}</span>}
              {c.resolution && <span className="block text-xs text-text-2">Settled: {c.resolution}</span>}
            </Td>
            <Td className="whitespace-nowrap tabular">{date(c.openedOn)}</Td>
            <Td className="text-right whitespace-nowrap tabular">{c.amount ? money(c.amount, c.currency ?? currency) : <span className="text-muted">—</span>}</Td>
            <Td>{c.bearer ? (CLAIM_BEARER_LABEL[c.bearer as ClaimBearer] ?? c.bearer) : <span className="text-muted">—</span>}</Td>
            <Td>
              <Badge tone={CLAIM_STATUS_TONE[c.status]}>
                {c.statusLabel}
                {c.resolvedOn ? ` ${date(c.resolvedOn)}` : ""}
              </Badge>
            </Td>
            <Td className="text-right">
              {actions?.[c.id] && (
                <FormWindow button={{ label: "Edit" }} title="A claim" sub={`${sub} · ${c.title}`} size="md">
                  {(close) => <ClaimUpdateForm action={actions[c.id]!} claim={c} onDone={close} />}
                </FormWindow>
              )}
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
