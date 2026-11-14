import Link from "next/link";
import { agoText, forText, type DevOverview } from "@kebo/shared";
import { Card, CardHeader, EmptyState, StatRow, StatTile } from "@kebo/ui";
import { currentZone } from "@/lib/format";
import { CheckMap, Dot, LineChart, NeedsYou, Timeline, UseBar, gbText } from "./parts";

const hour = (iso: string, zone: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: zone });

/** Big picture: what needs you, the headline figures, everything watched, what happened, the version. */
export function BigPicture({ o, days }: { o: DevOverview; days: 1 | 7 }) {
  const zone = currentZone();
  const t = o.tiles;
  const levels = { ok: 0, warn: 0, bad: 0, off: 0 };
  for (const c of o.checks) levels[c.level] += 1;
  const since = Date.parse(o.now) - days * 86_400_000;
  const events = o.events.filter((e) => Date.parse(e.at) >= since);
  const labels = o.chart.length ? [hour(o.chart[0]!.t, zone), hour(o.chart[Math.floor(o.chart.length / 2)]!.t, zone), "now"] : ["", ""];
  return (
    <div className="flex flex-col gap-4">
      {!o.checkedAt && (
        <div className="rounded-xl border border-info/25 bg-info-soft px-4 py-3 text-sm">
          <p className="font-semibold">The server&apos;s status is not set up yet.</p>
          <p className="text-text-2">
            The next deploy installs it by itself. By hand, on the server: <code className="font-mono text-xs">bash deploy/server/install.sh</code>
          </p>
        </div>
      )}
      <NeedsYou checks={o.checks} />
      <StatRow>
        <StatTile size="sm" label="CPU" value={t.cpu === null ? "—" : `${Math.round(t.cpu)}%`} sub={t.cores ? `${t.cores} cores · busy ${t.load ?? "—"} on average` : undefined} bar={t.cpu !== null ? <UseBar percent={t.cpu} /> : undefined} />
        <StatTile
          size="sm"
          label="Memory"
          value={t.memory ? `${gbText(t.memory.usedMb / 1024)} of ${gbText(t.memory.totalMb / 1024)}` : "—"}
          bar={t.memory ? <UseBar percent={t.memory.percent} /> : undefined}
          sub={t.memory ? `${Math.round(t.memory.percent)}% used` : undefined}
        />
        <StatTile
          size="sm"
          label="Disk"
          value={t.disk ? `${Math.round(t.disk.percent)}% full` : "—"}
          bar={t.disk ? <UseBar percent={t.disk.percent} /> : undefined}
          sub={t.disk ? `${gbText(t.disk.freeGb)} free of ${gbText(t.disk.totalGb)}` : undefined}
          tone={t.disk && t.disk.percent >= 90 ? "bad" : t.disk && t.disk.percent >= 80 ? "warn" : undefined}
          href="/platform/dev-tools?tab=data"
        />
        <StatTile
          size="sm"
          label="Last good backup"
          value={t.backupAt ? agoText(t.backupAt) : "none yet"}
          tone={t.backupLevel === "bad" ? "bad" : t.backupLevel === "warn" ? "warn" : undefined}
          sub={t.backupLevel === "ok" ? "and copied off the server" : t.backupLevel === "warn" ? "see Disk, database and backups" : t.backupLevel === "bad" ? "too old: see Backups" : undefined}
          href="/platform/dev-tools?tab=data"
        />
        <StatTile
          size="sm"
          label="Services running"
          value={t.services.all ? `${t.services.running} of ${t.services.all}` : "—"}
          tone={t.services.all && t.services.running < t.services.all ? "bad" : undefined}
          sub={t.services.all && t.services.running < t.services.all ? "one has stopped" : "web, API, worker, database …"}
          href="/platform/dev-tools?tab=services"
        />
      </StatRow>

      <Card>
        <CardHeader
          title="Everything we watch"
          description={`${o.checks.length} checks, every minute · green is fine, amber needs you this week, red needs you now`}
          actions={
            <span className="flex flex-wrap gap-3 text-xs text-text-2">
              <span className="inline-flex items-center gap-1.5">
                <Dot level="ok" /> fine {levels.ok}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Dot level="warn" /> this week {levels.warn}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Dot level="bad" /> now {levels.bad}
              </span>
              {levels.off > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <Dot level="off" /> not set up {levels.off}
                </span>
              )}
            </span>
          }
        />
        <CheckMap checks={o.checks} />
      </Card>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={days === 7 ? "What happened, last 7 days" : "What happened, last 24 hours"}
            description="deploys, restarts, warnings and backups on one line: see what changed before something broke"
            actions={
              <Link href={days === 7 ? "/platform/dev-tools" : "/platform/dev-tools?days=7"} className="text-sm font-medium text-primary hover:underline">
                {days === 7 ? "Last 24 hours" : "Last 7 days"}
              </Link>
            }
          />
          {events.length ? <Timeline events={events} zone={zone} /> : <EmptyState title="Nothing happened" description="No deploy, restart or warning in this time." />}
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Last 24 hours" description="how busy the server was, every 15 minutes" />
            <div className="p-4">
              {o.chart.length > 1 ? (
                <LineChart
                  label="CPU and memory used over the last 24 hours"
                  labels={labels}
                  series={[
                    { name: "CPU", values: o.chart.map((c) => c.cpu) },
                    { name: "Memory", values: o.chart.map((c) => c.mem) },
                  ]}
                />
              ) : (
                <p className="text-sm text-muted">Shows here after the first half hour of status.</p>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Version" description="what is running now, and the deploys before it" />
            {o.deploys.length ? (
              <ul className="flex flex-col">
                {o.deploys.map((d, k) => (
                  <li key={`${d.commit}-${d.at}`} className="flex items-center gap-3 border-b border-line px-4 py-2.5 text-sm last:border-b-0">
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-xs font-medium">{d.commit}</span>
                      <span className="block truncate text-xs text-text-2">
                        {d.title} · {new Date(d.at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: zone })}
                      </span>
                    </span>
                    <span className="text-xs text-muted">{!d.ok ? "failed" : k === 0 ? "live" : "before"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-3 text-sm text-muted">Deploys show here from the next one.</p>
            )}
            {o.host && (
              <p className="border-t border-line bg-surface-2 px-4 py-2.5 text-xs text-muted">
                Server up {forText(o.host.uptimeSec)}
                {o.host.os ? ` · ${o.host.os}` : ""}
                {o.host.docker ? ` · Docker ${o.host.docker}` : ""}
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
