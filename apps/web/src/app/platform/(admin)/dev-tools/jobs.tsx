import { agoText, type DevJobsView } from "@kebo/shared";
import { Card, CardHeader, EmptyState, StatRow, StatTile, Table, Td, Th, THead, Tr, Dash } from "@kebo/ui";
import { LevelBadge } from "./parts";
import { msText } from "./speed";

const dayShort = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });

/** Seven days of sent and not delivered, as small bars (one hue; not delivered in amber above). */
function DayBars({ days, label }: { days: { day: string; sent: number; failed: number }[]; label: string }) {
  const max = Math.max(1, ...days.map((d) => d.sent + d.failed));
  return (
    <figure className="flex flex-col gap-1.5">
      <div className="flex h-24 items-end gap-2" role="img" aria-label={label}>
        {days.map((d) => (
          <span key={d.day} className="flex h-full flex-1 flex-col justify-end" title={`${d.day}: ${d.sent} sent, ${d.failed} not delivered`}>
            {d.failed > 0 && <span className="block rounded-t-sm bg-warn" style={{ height: `${Math.max(4, (d.failed / max) * 100)}%` }} />}
            <span className="block rounded-t-sm bg-chart-1" style={{ height: `${(d.sent / max) * 100}%` }} />
          </span>
        ))}
      </div>
      <figcaption className="flex gap-2 text-2xs text-muted">
        {days.map((d, k) => (
          <span key={d.day} className="flex-1 text-center">
            {k === days.length - 1 ? "today" : dayShort(d.day)}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/** Jobs and emails: what runs by itself and how it went, what was sent and not delivered, and when you get a warning email. */
export function JobsTab({ v }: { v: DevJobsView }) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="Jobs that run by themselves" description="the app's worker and the server run these on a timer" />
        <Table>
          <THead>
            <Tr>
              <Th>Job</Th>
              <Th>Last run</Th>
              <Th className="text-right">Took</Th>
              <Th>What it did</Th>
              <Th>Status</Th>
            </Tr>
          </THead>
          <tbody>
            {v.jobs.map((j) => (
              <Tr key={j.key}>
                <Td>
                  <span className="block font-medium">{j.label}</span>
                  <span className="block text-xs text-muted">
                    {j.schedule} · {j.by === "worker" ? "the worker" : "the server"}
                  </span>
                </Td>
                <Td className="whitespace-nowrap">{j.lastAt ? agoText(j.lastAt) : "—"}</Td>
                <Td className="text-right tabular">{j.tookMs === null ? "—" : msText(j.tookMs)}</Td>
                <Td className="max-w-[340px] text-sm">
                  {j.result ?? <Dash />}
                  {j.failed7d > 0 && <span className="block text-xs text-bad">failed {j.failed7d === 1 ? "once" : `${j.failed7d} times`} in 7 days</span>}
                </Td>
                <Td>
                  <LevelBadge level={j.level}>{j.level === "ok" ? "Done" : j.level === "off" ? "Not run yet" : j.ok === false ? "Failed" : "Late"}</LevelBadge>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <StatRow>
        <StatTile size="sm" label="Emails today" value={String(v.email.today.sent)} sub={v.email.today.failed ? `${v.email.today.failed} not delivered` : "all delivered"} tone={v.email.today.failed ? "warn" : undefined} />
        <StatTile size="sm" label="Phone notifications today" value={String(v.push.today.sent)} sub={v.push.today.failed ? `${v.push.today.failed} not delivered` : "all delivered"} tone={v.push.today.failed ? "warn" : undefined} />
        <StatTile size="sm" label="Phones signed in" value={String(v.push.phones)} sub="with the phone app" />
      </StatRow>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Emails" description="sent, and not delivered (amber), last 7 days" />
          <div className="p-4">
            <DayBars days={v.email.days} label="Emails sent each day, last 7 days" />
          </div>
        </Card>
        <Card>
          <CardHeader title="Phone notifications" description="sent, and not delivered (amber), last 7 days" />
          <div className="p-4">
            <DayBars days={v.push.days} label="Phone notifications sent each day, last 7 days" />
          </div>
        </Card>
        <Card>
          <CardHeader title="Not delivered" description="last 7 days" />
          {v.failures.length ? (
            <ul className="flex max-h-[260px] flex-col scroll-xy">
              {v.failures.map((f, k) => (
                <li key={`${f.at}-${k}`} className="border-b border-line px-4 py-2.5 text-sm last:border-b-0">
                  <span className="block font-medium">{f.reason}</span>
                  <span className="block text-xs text-text-2">
                    {[f.channel === "email" ? "Email" : "Phone", f.what, f.to, f.companyName, agoText(f.at)].filter(Boolean).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Everything was delivered" />
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="When you get a warning email" description="to the platform admins, at most once a day for the same problem" />
        <Table>
          <THead>
            <Tr>
              <Th>When</Th>
              <Th>Now</Th>
              <Th></Th>
            </Tr>
          </THead>
          <tbody>
            {v.limits.map((l) => (
              <Tr key={l.label}>
                <Td>{l.label}</Td>
                <Td className="text-text-2">{l.now}</Td>
                <Td>
                  <LevelBadge level={l.level}>{l.level === "ok" ? "OK" : l.level === "off" ? "Not known" : l.level === "bad" ? "Emailed" : "Warning"}</LevelBadge>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
