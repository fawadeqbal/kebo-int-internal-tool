import Link from "next/link";
import { agoText, type DevServicesView } from "@kebo/shared";
import { Card, CardHeader, EmptyState, Table, Td, Th, THead, Tr, cn } from "@kebo/ui";
import { Facts, LevelBadge, UseBar, mbText } from "./parts";
import { LiveLog } from "./live-log";

const upFor = (iso: string | null) => {
  if (!iso) return "—";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  return s < 3600 ? `${Math.max(1, Math.round(s / 60))} min` : s < 48 * 3600 ? `${Math.round(s / 3600)} hours` : `${Math.round(s / 86400)} days`;
};

/** Services: each container's health and use, and the live log of the one picked. */
export function ServicesTab({ v, picked }: { v: DevServicesView; picked?: string }) {
  if (!v.services.length)
    return (
      <Card>
        <EmptyState
          framed
          title="No services yet"
          description="They show here once the server writes its status. The next deploy sets it up; by hand: bash deploy/server/install.sh"
        />
      </Card>
    );
  const withLog = v.services.filter((s) => s.hasLog);
  const first = v.services.find((s) => s.hasLog && s.level !== "ok") ?? withLog.find((s) => s.key === "api") ?? withLog[0];
  const service = (picked && v.services.find((s) => s.key === picked)) || first || v.services[0]!;
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="Services" description="each part of the app runs in its own container · pick one to see its live log" />
        <Table>
          <THead>
            <Tr>
              <Th>Service</Th>
              <Th>Status</Th>
              <Th>Up for</Th>
              <Th className="text-right">Restarts today</Th>
              <Th className="text-right">CPU</Th>
              <Th>Memory (RAM) used, of its limit</Th>
            </Tr>
          </THead>
          <tbody>
            {v.services.map((s) => {
              const pct = s.memMb && s.memLimitMb ? (100 * s.memMb) / s.memLimitMb : null;
              return (
                <Tr key={s.key} className={cn(s.key === service.key && "bg-primary-soft")}>
                  <Td>
                    <Link href={`/platform/dev-tools?tab=services&service=${s.key}`} scroll={false} className="font-medium text-primary hover:underline" aria-current={s.key === service.key ? "true" : undefined}>
                      {s.label}
                    </Link>
                    <span className="block text-xs text-muted">{s.role}</span>
                  </Td>
                  <Td>
                    <LevelBadge level={s.level}>{s.status}</LevelBadge>
                  </Td>
                  <Td className="whitespace-nowrap">{s.state === "running" ? upFor(s.startedAt) : "—"}</Td>
                  <Td className="text-right tabular">{s.restarts24h}</Td>
                  <Td className="text-right tabular">{s.cpu === null ? "—" : `${Math.round(s.cpu * 10) / 10}%`}</Td>
                  <Td className="min-w-[150px]">
                    <span className="block text-sm tabular">
                      {mbText(s.memMb)}
                      {s.memLimitMb ? <span className="text-xs text-muted"> of {mbText(s.memLimitMb)}</span> : null}
                    </span>
                    {pct !== null && <UseBar percent={pct} className="mt-1 w-32" />}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
        <p className="border-t border-line bg-surface-2 px-4 py-2.5 text-xs text-muted">
          Checked {agoText(v.checkedAt)} · every minute · Memory is working memory (RAM), not disk: the limit is the most a service may use, not space set aside. Disk space is under Disk, database and backups.
        </p>
      </Card>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {v.logsOn ? (
          <LiveLog key={service.key} service={service.key} services={v.services.map((s) => ({ key: s.key, label: s.label }))} />
        ) : (
          <Card>
            <EmptyState framed title="Live logs are not set up" description="The API needs the logs folder (LIVE_LOGS_DIR): the next deploy sets it up." />
          </Card>
        )}
        <Card>
          <CardHeader title={service.label} description={service.role} actions={<LevelBadge level={service.level}>{service.status}</LevelBadge>} />
          <div>
            <Facts
              items={[
                { label: "Running since", value: service.startedAt && service.state === "running" ? new Date(service.startedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : null },
                { label: "Restarts today", value: String(service.restarts24h) },
                { label: "Last restart", value: service.lastRestart ? `${agoText(service.lastRestart.at)}: ${service.lastRestart.why}` : "none" },
                { label: "Memory (RAM) limit", value: service.memLimitMb ? `${mbText(service.memLimitMb)}: the most it may use` : "no limit" },
              ]}
            />
            {service.lastRestart?.why === "out of memory" && (
              <p className="border-t border-line px-4 py-3 text-sm text-text-2">
                It ran out of memory. Raise its limit in the server&apos;s .env (for the worker: WORKER_MEMORY, for the API: API_MEMORY), then deploy again.
              </p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
