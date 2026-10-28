import Link from "next/link";
import { Card, CardBody, CardHeader, EmptyState, Table, Td, Th, THead, Tr } from "@kebo/ui";
import type { SiteFigures, SiteNumbers } from "@/app/platform/(admin)/website/types";

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 1000) / 10}%` : "–");
const monthName = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });

function Change({ now, before }: { now: number; before: number }) {
  if (!before) return null;
  const c = Math.round(((now - before) / before) * 100);
  return (
    <span className={c >= 0 ? "text-ok" : "text-bad"}>
      {c >= 0 ? "▲" : "▼"} {Math.abs(c)}%
    </span>
  );
}

/**
 * The marketing site in numbers: visitors, the leads they became, how many
 * reached a demo or trial and how many pay; this month against the last, and
 * per channel (where they came from).
 */
export function SiteNumbersCard({ n }: { n: SiteNumbers }) {
  const steps: {
    label: string;
    key: keyof Pick<SiteFigures, "visitors" | "leads" | "demos" | "clients">;
    of?: keyof SiteFigures;
    hint: string;
  }[] = [
    { label: "Visitors", key: "visitors", hint: "Each person once a day, no cookies" },
    { label: "Leads", key: "leads", of: "visitors", hint: "Demo requests, questions, sign-ups" },
    { label: "Demo or trial", key: "demos", of: "leads", hint: "Leads that got a demo or trial" },
    { label: "Paying", key: "clients", of: "demos", hint: "Leads that became clients" },
  ];
  const peak = Math.max(1, ...n.last30.map((d) => d.visitors));
  return (
    <Card id="website" className="scroll-mt-20">
      <CardHeader
        title="Website"
        description={`${monthName(n.now.month)} so far, against ${monthName(n.before.month)}. Leads are counted in the month they came in.`}
        actions={
          <Link href="/platform/website" className="text-sm font-medium text-primary hover:underline">
            Edit the page
          </Link>
        }
      />
      <CardBody className="flex flex-col gap-6">
        <ol className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {steps.map((s) => (
            <li key={s.key} className="rounded-lg border border-line p-3">
              <p className="text-sm text-muted">{s.label}</p>
              <p className="mt-1 text-2xl font-semibold tabular">{n.now[s.key]}</p>
              <p className="text-xs text-muted">
                {s.of ? `${pct(n.now[s.key], n.now[s.of] as number)} of ${steps.find((x) => x.key === s.of)!.label.toLowerCase()} · ` : ""}
                {n.before[s.key]} last month <Change now={n.now[s.key]} before={n.before[s.key]} />
              </p>
              <p className="mt-1 text-xs text-muted">{s.hint}</p>
            </li>
          ))}
        </ol>

        <figure>
          <figcaption className="mb-2 text-sm font-medium">Visitors, last 30 days</figcaption>
          {n.last30.some((d) => d.visitors > 0) ? (
            <div
              className="flex h-20 items-end gap-0.5"
              role="img"
              aria-label={`Visitors per day for the last 30 days, at most ${peak} a day`}
            >
              {n.last30.map((d) => (
                <span
                  key={d.day}
                  title={`${d.day}: ${d.visitors}`}
                  className={d.visitors ? "min-w-0 flex-1 rounded-t-sm bg-primary/70" : "min-w-0 flex-1 rounded-t-sm bg-line"}
                  style={{ height: `${Math.max(2, (d.visitors / peak) * 100)}%` }}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">No visits yet. Share the page link to start.</p>
          )}
        </figure>

        {n.now.channels.length ? (
          <Table>
            <THead>
              <tr>
                <Th>Came from</Th>
                <Th className="text-right">Visitors</Th>
                <Th className="text-right">Leads</Th>
                <Th className="text-right">Demo or trial</Th>
                <Th className="text-right">Paying</Th>
              </tr>
            </THead>
            <tbody>
              {n.now.channels.map((c) => (
                <Tr key={c.channel}>
                  <Td className="font-medium">{c.channel}</Td>
                  <Td className="text-right tabular">{c.visitors}</Td>
                  <Td className="text-right tabular">
                    {c.leads}
                    {c.visitors ? <span className="ml-1 text-xs text-muted">({pct(c.leads, c.visitors)})</span> : null}
                  </Td>
                  <Td className="text-right tabular">{c.demos}</Td>
                  <Td className="text-right tabular">{c.clients}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState
            title="No visitors or leads this month yet"
            description="Add ?utm_source=facebook&utm_campaign=… to the links in your ads and posts: each source then shows here with its leads."
          />
        )}
      </CardBody>
    </Card>
  );
}
