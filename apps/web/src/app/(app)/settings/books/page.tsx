import { Card, CardBody, CardHeader } from "@kebo/ui";
import { lastMonths } from "@kebo/utils";
import { api } from "@/lib/api";
import { date, dateTime } from "@/lib/format";
import { SettingsPage } from "../section";
import { CloseBooksForm, type BooksView } from "./form";

export const metadata = { title: "Closed months · Settings" };

/** The months before a day, as choices: "October 2026" for 2026-10, the latest first. */
function monthsUpTo(latest: string, count = 18) {
  return lastMonths(latest, count)
    .reverse()
    .map((m) => ({ value: m, label: new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) }));
}

/**
 * Settings › Closed months: money dated on or before the closed day stays as it was reported. A payment,
 * cost, transfer or allocation dated then is refused, and so is changing or removing one (the database's own
 * rule). Opening a month again says why; both are in the audit log.
 */
export default async function BooksPage() {
  const v = await api.get<BooksView>("/books/close");
  return (
    <SettingsPage href="/settings/books">
      <Card>
        <CardHeader
          title={v.closedThrough ? `Closed through ${date(v.closedThrough)}` : "No month is closed"}
          description={
            v.closedThrough
              ? `By ${v.closedBy ?? "someone no longer here"}, ${v.closedAt ? dateTime(v.closedAt) : ""}${v.reason ? ` · ${v.reason}` : ""}`
              : "Payments, costs and transfers of any date can still be added, changed and removed."
          }
        />
        <CardBody>
          <CloseBooksForm view={v} months={monthsUpTo(v.latest)} />
        </CardBody>
      </Card>
    </SettingsPage>
  );
}
