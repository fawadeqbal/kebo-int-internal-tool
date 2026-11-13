"use client";

import { Field, Input, Select } from "@kebo/ui";
import { useAccounts } from "@/components/money/accounts";
import { repayAction } from "@/app/(app)/money/actions";
import { FieldRow, SectionWindow } from "./section-window";

/**
 * "Pay" on a cost that waits: the bill is paid on a day, from one of our accounts. The transfer slip is kept
 * with the order's costs.
 */
export function PayCostWindow({
  orderId,
  id,
  currency,
  sub,
  today,
  from,
  canFiles,
}: {
  /** Null: a bill of the company, on no order. */
  orderId: string | null;
  id: string;
  currency: string;
  /** "Sino-Africa Logistics · Sea freight · USD 6,400.00". */
  sub: string;
  today: string;
  /** The earliest day it can be paid (the day the cost is dated). */
  from: string;
  canFiles: boolean;
}) {
  const accounts = useAccounts().filter((a) => a.currency === currency && !a.archived);
  return (
    <SectionWindow
      button={{ label: "Pay", kind: "plain" }}
      title="Pay"
      sub={sub}
      action={repayAction.bind(null, orderId, [id])}
      submit="Pay"
      whats={["The cost shows the day it was paid.", "It leaves “to pay” and shows under Payments."]}
      files={canFiles && orderId ? { orderId, section: "expenses", hint: "the transfer slip" } : undefined}
    >
      {(s) => (
        <FieldRow>
          <Field label="Paid on" htmlFor={`pay-${id}`} error={s.errors?.repaidOn}>
            <Input id={`pay-${id}`} name="repaidOn" type="date" min={from} max={today} defaultValue={s.values?.repaidOn ?? today} />
          </Field>
          <Field label="From" htmlFor={`pay-acc-${id}`} optional error={s.errors?.accountId}>
            <Select id={`pay-acc-${id}`} name="accountId" defaultValue={s.values?.accountId ?? ""}>
              <option value="">Not said</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
        </FieldRow>
      )}
    </SectionWindow>
  );
}

/**
 * "Repay": pays back what one person paid from their own money on this order, on a day, from one of
 * our accounts. The transfer slip is kept with the order's expenses.
 */
export function RepayWindow({
  orderId,
  ids,
  currency,
  name,
  amount,
  today,
  canFiles,
}: {
  /** Null: an expense of the company, on no order. */
  orderId: string | null;
  /** The expenses repaid together. */
  ids: string[];
  currency: string;
  name: string;
  /** "USD 4,120.00". */
  amount: string;
  today: string;
  canFiles: boolean;
}) {
  const accounts = useAccounts().filter((a) => a.currency === currency && !a.archived);
  return (
    <SectionWindow
      button={{ label: "Repay", kind: "plain" }}
      title="Repay"
      sub={`${name} paid ${amount} from their own money`}
      action={repayAction.bind(null, orderId, ids)}
      submit="Repay"
      whats={[ids.length === 1 ? "The expense shows the day it was repaid." : `The ${ids.length} expenses show the day they were repaid.`]}
      files={canFiles && orderId ? { orderId, section: "expenses", hint: "the transfer slip" } : undefined}
    >
      {(s) => (
        <FieldRow>
          <Field label="Repaid on" htmlFor={`repay-${ids[0]}`} error={s.errors?.repaidOn}>
            <Input id={`repay-${ids[0]}`} name="repaidOn" type="date" max={today} defaultValue={s.values?.repaidOn ?? today} />
          </Field>
          <Field label="From account" htmlFor={`repay-acc-${ids[0]}`} optional error={s.errors?.accountId}>
            <Select id={`repay-acc-${ids[0]}`} name="accountId" defaultValue={s.values?.accountId ?? ""}>
              <option value="">Not said</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
        </FieldRow>
      )}
    </SectionWindow>
  );
}
