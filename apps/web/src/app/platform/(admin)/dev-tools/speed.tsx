import { agoText, type DevSpeedView } from "@kebo/shared";
import { Badge, Card, CardHeader, EmptyState, Segmented, StatRow, StatTile, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { currentZone } from "@/lib/format";
import { CopyForClaude, MarkError } from "./error-actions";
import { LineChart } from "./parts";

export const msText = (ms: number | null) => (ms === null ? "—" : ms >= 1000 ? `${Math.round(ms / 100) / 10} s` : `${ms} ms`);

/** Speed and errors: how fast the app answered, the slowest routes, the errors (each once), the outside watcher. */
export function SpeedTab({ v, errors }: { v: DevSpeedView; errors: "open" | "fixed" }) {
  const zone = currentZone();
  const label = (iso: string) =>
    new Date(iso).toLocaleString("en-GB", v.range === "7d" ? { day: "numeric", month: "short", timeZone: zone } : { hour: "2-digit", minute: "2-digit", timeZone: zone });
  const peak = Math.max(400, ...v.chart.map((c) => c.slowMs ?? 0));
  const href = (patch: { range?: string; errors?: string }) => {
    const q = new URLSearchParams({ tab: "speed" });
    const range = patch.range ?? v.range;
    const err = patch.errors ?? errors;
    if (range === "7d") q.set("range", "7d");
    if (err === "fixed") q.set("errors", "fixed");
    return `/platform/dev-tools?${q.toString()}`;
  };
  const period = v.range === "7d" ? "7 days" : "24 hours";
  const open = v.errorsList.filter((e) => e.status === "open").length;
  return (
    <div className="flex flex-col gap-4">
      <StatRow>
        <StatTile size="sm" label={`Requests, ${period}`} value={v.requests.toLocaleString("en-US")} sub={v.range === "24h" ? `about ${Math.round(v.requests / 1440)} a minute` : undefined} />
        <StatTile size="sm" label="Typical answer" value={msText(v.typicalMs)} sub="half of all requests are faster" />
        <StatTile size="sm" label="Slowest 5%" value={msText(v.slowMs)} sub="what people feel" tone={v.slowMs !== null && v.slowMs >= 2000 ? "warn" : undefined} />
        <StatTile
          size="sm"
          label={`Server errors, ${period}`}
          value={String(v.errors)}
          tone={v.errors ? "bad" : undefined}
          sub={v.requests ? `${Math.round((100000 * v.errors) / v.requests) / 1000}% of requests` : undefined}
        />
        <StatTile size="sm" label="Up, last 7 days" value={v.upPercent === null ? "—" : `${v.upPercent}%`} sub="the API answered the server's check every minute" />
      </StatRow>

      <Card>
        <CardHeader
          title="How fast the app answered"
          description={`every ${v.range === "7d" ? "6 hours" : "hour"}, last ${period}`}
          actions={
            <Segmented
              label="Period"
              options={[
                { href: href({ range: "24h" }), label: "24 hours", active: v.range === "24h" },
                { href: href({ range: "7d" }), label: "7 days", active: v.range === "7d" },
              ]}
            />
          }
        />
        <div className="p-4">
          {v.requests ? (
            <LineChart
              label="Answer times"
              unit=" ms"
              max={peak * 1.1}
              labels={[label(v.chart[0]!.t), label(v.chart[Math.floor(v.chart.length / 2)]!.t), "now"]}
              series={[
                { name: "Typical answer", values: v.chart.map((c) => c.typicalMs) },
                { name: "Slowest 5%", values: v.chart.map((c) => c.slowMs) },
              ]}
            />
          ) : (
            <p className="text-sm text-muted">No requests yet in this time.</p>
          )}
        </div>
      </Card>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Slowest pages and calls" description={`by the slowest 5%, last ${period} (5 requests or more)`} />
          {v.slowest.length ? (
            <Table>
              <THead>
                <Tr>
                  <Th>Call</Th>
                  <Th className="text-right">Times</Th>
                  <Th className="text-right">Typical</Th>
                  <Th className="text-right">Slowest 5%</Th>
                </Tr>
              </THead>
              <tbody>
                {v.slowest.map((r) => (
                  <Tr key={r.route}>
                    <Td className="font-mono text-xs break-all">
                      {r.route}
                      {r.errors > 0 && <span className="ml-2 font-sans text-bad">{r.errors} errors</span>}
                    </Td>
                    <Td className="text-right tabular">{r.count.toLocaleString("en-US")}</Td>
                    <Td className="text-right tabular">{msText(r.typicalMs)}</Td>
                    <Td className={`text-right tabular ${r.slowMs !== null && r.slowMs >= 2000 ? "font-semibold text-warn" : ""}`}>{msText(r.slowMs)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <EmptyState title="Not enough requests yet" />
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              title="Errors"
              description="each kind counted once · no customer data is shown"
              actions={
                <Segmented
                  label="Show"
                  options={[
                    { href: href({ errors: "open" }), label: errors === "open" ? `Open (${open})` : "Open", active: errors === "open" },
                    { href: href({ errors: "fixed" }), label: `Fixed (${v.fixedCount})`, active: errors === "fixed" },
                  ]}
                />
              }
            />
            {v.errorsList.length ? (
              <ul className="flex flex-col">
                {v.errorsList.map((e) => (
                  <li key={e.id} className="border-b border-line last:border-b-0">
                    <details className="group">
                      <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3 hover:bg-surface-2">
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium break-words">{e.message}</span>
                          <span className="block text-xs text-text-2">
                            {[e.where, `${e.count} ${e.count === 1 ? "time" : "times"}`, `last ${agoText(e.lastAt)}`, e.companyName].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                        <Badge tone={e.status === "open" ? "bad" : "ok"}>{e.status === "open" ? "Open" : "Fixed"}</Badge>
                      </summary>
                      <div className="flex flex-col gap-3 px-4 pb-4">
                        <pre className="max-h-64 overflow-auto rounded-lg bg-[#15141b] p-3 font-mono text-xs leading-[18px] whitespace-pre-wrap text-[#e6e5ee]">
                          {e.stack ?? `${e.name}: ${e.message}`}
                        </pre>
                        <p className="text-xs text-text-2">
                          First {agoText(e.firstAt)}
                          {e.afterDeploy ? `, after deploy ${e.afterDeploy}` : ""} · last {agoText(e.lastAt)}
                          {e.userName ? ` · last for ${e.userName}` : ""}
                          {e.path ? ` · ${e.path}` : ""}
                        </p>
                        <span className="flex flex-wrap gap-2">
                          <CopyForClaude error={e} />
                          <MarkError id={e.id} status={e.status === "open" ? "fixed" : "open"} />
                        </span>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title={errors === "open" ? "No open errors" : "Nothing marked fixed"} description={errors === "open" ? "A server error shows here once, however often it happens." : undefined} />
            )}
          </Card>
          <Card>
            <CardHeader title="Outside watcher" description="GitHub checks the site every 5 minutes, from outside the server" />
            <div className="flex flex-col gap-2 px-4 py-3 text-sm">
              <p>
                {v.outside.lastAt ? (
                  <>
                    Last check <span className="font-medium">{agoText(v.outside.lastAt)}</span> · {v.outside.checks24h} in the last 24 hours
                  </>
                ) : (
                  "No check from outside yet: it starts once this is on main (GitHub Actions › Watch the site)."
                )}
              </p>
              <p className="text-text-2">
                If the site does not answer three times in a row, GitHub emails you, even when the whole server is off and this page cannot.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
