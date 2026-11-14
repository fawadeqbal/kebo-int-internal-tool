import { agoText, type DevDataView } from "@kebo/shared";
import { Card, CardHeader, Meter, RankedBars, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { Facts, LevelBadge, LineChart, gbText, mbText } from "./parts";

const short = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Disk, database and backups: how full the disk is and why, the backups, and the database. */
export function DataTab({ d }: { d: DevDataView }) {
  const disk = d.disk;
  const b = d.backup;
  const db = d.database;
  const days = d.days;
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader
            title="The server's disk"
            description={disk ? `${gbText(disk.totalGb)} in all` : "not checked yet"}
            actions={disk && <LevelBadge level={disk.percent >= 90 ? "bad" : disk.percent >= 80 ? "warn" : "ok"}>{`${Math.round(disk.percent)}% full`}</LevelBadge>}
          />
          <div className="p-4">
            {disk ? (
              <Meter
                label={`${gbText(disk.usedGb)} used`}
                figure={`${gbText(disk.freeGb)} free`}
                percent={disk.percent}
                tone={disk.percent >= 80 ? "warn" : undefined}
                hint={
                  d.fullInDays !== null
                    ? `Full in about ${d.fullInDays} days at this rate (${d.growthGbPerDay} GB a day). Warns you at 80% and again at 90%.`
                    : "Not growing. Warns you at 80% and again at 90%."
                }
              />
            ) : (
              <p className="text-sm text-muted">Shows here once the server writes its status.</p>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="What uses the space" description={d.spaceAt ? `biggest first · counted ${agoText(d.spaceAt)}, every hour` : "counted every hour"} />
          <div className="p-4">
            {d.space.length ? (
              <RankedBars label="What uses the disk" rows={[...d.space].filter((p) => p.gb > 0).sort((a, b) => b.gb - a.gb).map((p) => ({ key: p.key, label: p.label, value: p.gb, text: gbText(p.gb) }))} />
            ) : (
              <p className="text-sm text-muted">Not counted yet.</p>
            )}
          </div>
          <p className="border-t border-line bg-surface-2 px-4 py-2.5 text-xs text-muted">
            Every night at 03:30 the clean-up removes old app versions and build cache over 20 GB. It never touches the database, files or backups.
          </p>
        </Card>
        <Card>
          <CardHeader title="Disk used, last 30 days" />
          <div className="p-4">
            {days.length > 1 ? (
              <LineChart
                label="Disk used, by day"
                series={[{ name: "Disk used", values: days.map((x) => x.percent) }]}
                labels={[short(days[0]!.day), short(days[Math.floor(days.length / 2)]!.day), "today"]}
              />
            ) : (
              <p className="text-sm text-muted">Shows here after the second day.</p>
            )}
          </div>
        </Card>
      </div>
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader title="Backups" description="the database every night, copied off the server" actions={<LevelBadge level={b.level}>{b.level === "ok" ? "All good" : b.level === "off" ? "None yet" : b.level === "bad" ? "Needs you now" : "Needs a look"}</LevelBadge>} />
          <div>
            <Facts
              items={[
                { label: "Last good backup", value: b.lastGoodAt ? agoText(b.lastGoodAt) : null },
                { label: "Last try", value: b.lastTryAt ? `${agoText(b.lastTryAt)}${b.ok === false ? ", failed" : ""}` : null },
                { label: "Off-site copy", value: b.offsite === "ok" ? "made" : b.offsite === "failed" ? "failed" : b.offsite === "off" ? "off: on this server only" : null },
                { label: "File", value: b.dump },
              ]}
            />
            {b.message && <p className="px-4 pb-3 text-sm text-bad">{b.message}</p>}
          </div>
          <p className="border-t border-line bg-surface-2 px-4 py-2.5 text-xs text-muted">How to restore: docs/restore.md</p>
        </Card>
        <Card>
          <CardHeader title="Database" description={db.version ? `PostgreSQL ${db.version}` : undefined} actions={<LevelBadge level={db.ok ? "ok" : "bad"}>{db.ok ? "Answering" : "Not answering"}</LevelBadge>} />
          <div>
            <Facts
              items={[
                { label: "Size", value: db.sizeMb === null ? null : mbText(db.sizeMb) },
                { label: "Connections", value: db.connections === null ? null : `${db.connections} of ${db.maxConnections}` },
                { label: "Answers from memory", value: db.cacheHit === null ? null : `${db.cacheHit}%` },
                { label: "Longest query now", value: db.longestQuerySec === null ? null : `${db.longestQuerySec} s` },
              ]}
            />
          </div>
        </Card>
        <Card>
          <CardHeader title="Biggest tables" />
          <Table>
            <THead>
              <Tr>
                <Th>Table</Th>
                <Th className="text-right">Rows</Th>
                <Th className="text-right">Size</Th>
              </Tr>
            </THead>
            <tbody>
              {db.tables.map((t) => (
                <Tr key={t.name}>
                  <Td className="font-mono text-xs">{t.name}</Td>
                  <Td className="text-right tabular">{t.rows.toLocaleString("en-US")}</Td>
                  <Td className="text-right tabular">{mbText(t.mb)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
