import Link from "next/link";
import { EXPENSE_CATEGORY_LABEL, type InquiryStage } from "@kebo/shared";
import { Card, CardBody, CardHeader, cn, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { todayIn } from "@kebo/utils";
import { api } from "@/lib/api";
import { date, money, TZ } from "@/lib/format";
import type { ExpenseList, ExpenseTargets } from "@/lib/types-money";
import { ExpenseRecord } from "./expense-record";
import { DealCostForm } from "./deal-cost-form";
import { getSettings, getPeople } from "@/lib/loaders";

/**
 * What was spent on this deal (trips to check products, samples, visits),
 * managers only, beside "Add a cost". Won: it comes off the order's profit.
 * Lost: it is what the lost deal cost us. ?cost=<id> opens one to change,
 * add its receipt or remove it.
 */
export async function DealExpensesCard({
  deal,
  me,
  open,
}: {
  deal: { id: string; refNo: string; title: string; stage: InquiryStage; customer: { id: string; name: string }; order: { id: string; refNo: string } | null };
  me: string | null;
  open?: string;
}) {
  const today = todayIn(TZ);
  const [list, targets, people, settings] = await Promise.all([
    api.get<ExpenseList>("/expenses", { inquiryId: deal.id, pageSize: 200 }),
    api.get<ExpenseTargets>("/expenses/targets"),
    getPeople(),
    getSettings(),
  ]);
  const main = list.currency;
  const fx = { main: settings.sales.currency, rates: settings.sales.exchangeRates };
  const choices = {
    ...targets,
    customers: [deal.customer],
    deals: [{ id: deal.id, refNo: deal.refNo, title: deal.title, stage: deal.stage, customerId: deal.customer.id, customer: deal.customer.name }],
    orders: targets.orders.filter((o) => o.dealId === deal.id),
    customerId: deal.customer.id,
    dealId: deal.id,
  };
  // An order's own costs show on the order; here the ones before it.
  const rows = list.rows.filter((e) => !e.order);
  const live = rows.filter((e) => !e.voided);
  const one = live.length > 0 && live.every((e) => e.currency === live[0]!.currency) ? live[0]!.currency : null;
  const total = one ? live.reduce((t, e) => t + Number(e.amount), 0) : live.reduce((t, e) => t + Number(e.inMain), 0);
  const chosen = open ? rows.find((e) => e.id === open) : undefined;
  return (
    <div className="flex flex-wrap items-start gap-4">
      <div className="flex min-w-0 flex-[999_1_640px] flex-col gap-4">
        <Card>
          <CardHeader title="Spent on this inquiry" />
          {rows.length > 0 ? (
            <Table className="min-w-[720px]">
              <THead>
                <tr>
                  <Th>Date</Th>
                  <Th>Category</Th>
                  <Th>What</Th>
                  <Th>Paid by</Th>
                  <Th>Account</Th>
                  <Th className="text-right">Amount</Th>
                </tr>
              </THead>
              <tbody>
                {rows.map((e) => (
                  <Tr key={e.id} className={cn(e.voided && "text-muted line-through")}>
                    <Td className="whitespace-nowrap">{date(e.spentOn)}</Td>
                    <Td>{EXPENSE_CATEGORY_LABEL[e.category]}</Td>
                    <Td>
                      <Link href={`?cost=${e.id}#cost`} scroll={false} className="text-text hover:text-primary hover:underline">
                        {e.description}
                      </Link>
                    </Td>
                    <Td>{e.paidBy?.name ?? "—"}</Td>
                    <Td>{e.ownMoney ? (e.repaid ? `Own money · repaid ${date(e.repaid.on)}` : "Own money · to repay") : (e.account?.name ?? "—")}</Td>
                    <Td className="text-right whitespace-nowrap tabular">{money(e.amount, e.currency)}</Td>
                  </Tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line font-bold">
                  <Td colSpan={4} />
                  <Td>Total</Td>
                  <Td className="text-right whitespace-nowrap tabular">{money(total, one ?? main)}</Td>
                </tr>
              </tfoot>
            </Table>
          ) : (
            <CardBody>
              <p className="text-sm text-muted">Nothing spent on this inquiry yet.</p>
            </CardBody>
          )}
        </Card>
        {chosen && (
          <Card id="cost">
            <CardHeader
              title={chosen.description}
              actions={
                <Link href="?" scroll={false} className="text-sm text-primary hover:underline">
                  Close
                </Link>
              }
            />
            <CardBody>
              <ul className="rounded-lg border border-line">
                <ExpenseRecord e={chosen} mainCurrency={main} people={people} fx={fx} today={today} choices={choices} showFor={false} />
              </ul>
            </CardBody>
          </Card>
        )}
      </div>
      <aside className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
        <Card>
          <CardHeader title="Add a cost" />
          <CardBody>
            <DealCostForm dealId={deal.id} customerId={deal.customer.id} mainCurrency={main} fx={fx} today={today} people={people} me={me} />
          </CardBody>
        </Card>
      </aside>
    </div>
  );
}
