import Link from "next/link";
import { agoText, type DevCompaniesView } from "@kebo/shared";
import { Card, CardHeader, EmptyState, Table, Td, Th, THead, Tr, linkClass } from "@kebo/ui";
import { LevelBadge, mbText } from "./parts";

/** Companies: how each one is doing (trouble or no use first), and the busiest hours of the day. */
const SHOWN = 25;

export function CompaniesTab({ v, all }: { v: DevCompaniesView; all: boolean }) {
  const rows = all ? v.companies : v.companies.slice(0, SHOWN);
  const max = Math.max(1, ...v.busyHours);
  const quiet = v.busyHours
    .map((n, h) => ({ n, h }))
    .sort((a, b) => a.n - b.n)
    .slice(0, 3)
    .map((x) => x.h)
    .sort((a, b) => a - b);
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="How each company is doing" description="errors or no use for a week show first" />
        {v.companies.length ? (
          <Table>
            <THead>
              <Tr>
                <Th>Company</Th>
                <Th className="text-right">Used it this week</Th>
                <Th>Last used</Th>
                <Th className="text-right">Errors, 7 days</Th>
                <Th className="text-right">Orders</Th>
                <Th className="text-right">Files</Th>
                <Th></Th>
              </Tr>
            </THead>
            <tbody>
              {rows.map((c) => (
                <Tr key={c.id} href={`/platform/companies/${c.id}`}>
                  <Td>
                    <Link href={`/platform/companies/${c.id}`} className={linkClass}>
                      {c.name}
                    </Link>
                    <span className="block text-xs text-muted">
                      {[c.kind === "client" ? "Client" : c.kind === "demo" ? "Demo" : "Trial", c.plan, c.status !== "active" ? c.status.replace("_", "-") : null].filter(Boolean).join(" · ")}
                    </span>
                  </Td>
                  <Td className="text-right tabular">
                    {c.usedThisWeek} of {c.users}
                  </Td>
                  <Td className="whitespace-nowrap text-text-2">{c.lastUsedAt ? agoText(c.lastUsedAt) : "never"}</Td>
                  <Td className={`text-right tabular ${c.errors7d ? "font-semibold text-bad" : ""}`}>{c.errors7d}</Td>
                  <Td className="text-right tabular">{c.orders.toLocaleString("en-US")}</Td>
                  <Td className="text-right tabular">{mbText(c.filesMb)}</Td>
                  <Td>
                    <LevelBadge level={c.level}>{c.note}</LevelBadge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No companies yet" />
        )}
        {!all && v.companies.length > SHOWN && (
          <p className="border-t border-line bg-surface-2 px-4 py-2.5 text-sm">
            {v.companies.length - SHOWN} more, all fine or switched off.{" "}
            <Link href="/platform/dev-tools?tab=companies&all=1" className={linkClass}>
              Show all {v.companies.length}
            </Link>
          </p>
        )}
      </Card>
      <Card>
        <CardHeader title="Busiest hours" description="requests by hour of the day, all companies, last 7 days" />
        <div className="p-4">
          <div className="flex h-28 items-end gap-1" role="img" aria-label="Requests by hour of the day">
            {v.busyHours.map((n, h) => (
              <span key={h} className="block flex-1 rounded-t-sm bg-chart-1" style={{ height: `${Math.max(2, (n / max) * 100)}%` }} title={`${String(h).padStart(2, "0")}:00 · ${n.toLocaleString("en-US")} requests`} />
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-2xs text-muted tabular">
            <span>00:00</span>
            <span>06:00</span>
            <span>12:00</span>
            <span>18:00</span>
            <span>23:00</span>
          </div>
          <p className="mt-3 text-sm text-text-2">
            Quietest: {quiet.map((h) => `${String(h).padStart(2, "0")}:00`).join(", ")}. The best time for server updates and restarts.
          </p>
        </div>
      </Card>
    </div>
  );
}
