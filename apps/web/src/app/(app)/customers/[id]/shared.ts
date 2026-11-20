import type { CustomerPayments } from "@/lib/types-money";

type PayOrder = CustomerPayments["orders"][number];

/** An order the customer still owes on. */
export const owes = (o: PayOrder) => o.status !== "cancelled" && Number(o.due) > 0.005;
/** …with an instalment past its due day. */
export const late = (o: PayOrder, today: string) => owes(o) && !!o.next?.dueOn && o.next.dueOn < today;

