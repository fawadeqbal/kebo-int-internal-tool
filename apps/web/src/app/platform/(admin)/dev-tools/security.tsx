import { agoText, type DevSecurityView } from "@kebo/shared";
import { Card, CardHeader, EmptyState, StatRow, StatTile, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { Facts, LevelBadge, NeedsYou } from "./parts";

/** Security: sign-ins, two-step, and the server's safety (updates, open ports, SSH, certificates). */
export function SecurityTab({ v }: { v: DevSecurityView }) {
  const s = v.server;
  const extra = (s.ports ?? []).filter((p) => ![22, 80, 443].includes(p));
  return (
    <div className="flex flex-col gap-4">
      <NeedsYou checks={v.checks} />
      <StatRow>
        <StatTile size="sm" label="Failed sign-ins, 24 hours" value={String(v.signIns.failed24h)} sub={`${v.signIns.blocked24h} blocked · ${v.signIns.ok24h} signed in`} tone={v.signIns.blocked24h ? "warn" : undefined} />
        <StatTile size="sm" label="Platform admins with two-step" value={`${v.platformAdmins.withTwoStep} of ${v.platformAdmins.all}`} tone={v.platformAdmins.withTwoStep < v.platformAdmins.all ? "bad" : "ok"} sub={v.platformAdmins.locked ? `${v.platformAdmins.locked} locked now` : "all of them"} />
        <StatTile size="sm" label="Users without two-step" value={`${v.users.withoutTwoStep} of ${v.users.all}`} sub={v.users.managersWithout ? `${v.users.managersWithout} of them managers` : "no manager"} tone={v.users.managersWithout ? "warn" : undefined} />
        <StatTile size="sm" label="Server updates" value={s.updates ? String(s.updates.security) : "—"} sub={!s.updates ? "not checked yet" : s.updates.reboot ? "security · a restart is needed" : "security updates waiting"} tone={s.updates && (s.updates.security || s.updates.reboot) ? "warn" : undefined} />
      </StatRow>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Sign-ins that did not work" description="last 24 hours, the most first · addresses partly hidden" />
            {v.signIns.rows.length ? (
              <Table>
                <THead>
                  <Tr>
                    <Th>What</Th>
                    <Th>From</Th>
                    <Th className="text-right">Times</Th>
                    <Th>Last</Th>
                  </Tr>
                </THead>
                <tbody>
                  {v.signIns.rows.map((r, k) => (
                    <Tr key={`${r.who}-${r.ip}-${k}`}>
                      <Td>
                        <span className="block font-medium">{r.result}</span>
                        <span className="block text-xs text-muted">{[r.who, r.company].filter(Boolean).join(" · ")}</span>
                      </Td>
                      <Td className="font-mono text-xs">{r.ip}</Td>
                      <Td className={`text-right tabular ${r.level !== "ok" ? "font-semibold text-warn" : ""}`}>{r.times}</Td>
                      <Td className="whitespace-nowrap text-text-2">{agoText(r.lastAt)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <EmptyState title="Every sign-in worked" description="No wrong password or code in the last 24 hours." />
            )}
          </Card>
          <Card>
            <CardHeader title="People without two-step sign-in" description="they turn it on in My account · managers first, they see money and costs" />
            {v.withoutTwoStep.length ? (
              <Table>
                <THead>
                  <Tr>
                    <Th>Company</Th>
                    <Th className="text-right">Without two-step</Th>
                    <Th className="text-right">Of them managers</Th>
                  </Tr>
                </THead>
                <tbody>
                  {v.withoutTwoStep.slice(0, 10).map((r) => (
                    <Tr key={r.company}>
                      <Td className="font-medium">{r.company}</Td>
                      <Td className="text-right tabular">
                        {r.users} of {r.of}
                      </Td>
                      <Td className={`text-right tabular ${r.managers ? "font-semibold text-warn" : ""}`}>{r.managers}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <EmptyState title="Everyone has two-step" />
            )}
            {v.withoutTwoStep.length > 10 && (
              <p className="border-t border-line bg-surface-2 px-4 py-2.5 text-xs text-muted">and {v.withoutTwoStep.length - 10} more companies, with fewer people or no manager</p>
            )}
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="The server" description={s.checkedAt ? `checked ${agoText(s.checkedAt)} · updates every 6 hours` : "not checked yet"} />
            <Facts
              items={[
                { label: "Security updates", value: !s.updates ? null : s.updates.security ? <span className="text-warn">{s.updates.security} waiting</span> : "none waiting" },
                { label: "Restart needed", value: s.updates?.reboot == null ? null : s.updates.reboot ? <span className="text-warn">yes</span> : "no" },
                { label: "Open to the internet", value: !s.ports ? null : extra.length ? <span className="text-warn">{s.ports.join(", ")}</span> : `${s.ports.join(", ")} only` },
                { label: "Firewall", value: s.firewall === null ? null : s.firewall },
                { label: "SSH with a password", value: s.sshPassword === null ? null : s.sshPassword ? <span className="text-warn">on</span> : "off (keys only)" },
                { label: "Database from outside", value: !s.ports ? null : s.ports.includes(5432) ? <span className="text-bad">reachable</span> : "not reachable" },
              ]}
            />
            {s.updates && (s.updates.security > 0 || s.updates.reboot) && (
              <p className="border-t border-line px-4 py-3 text-sm text-text-2">
                At a quiet hour (see Companies › Busiest hours): <code className="font-mono text-xs">sudo apt upgrade</code>, then <code className="font-mono text-xs">sudo reboot</code>. The app starts again by itself.
              </p>
            )}
          </Card>
          <Card>
            <CardHeader title="Certificates" description="renewed by the address server (Caddy) by itself" />
            {s.certificates.length ? (
              <ul className="flex flex-col">
                {s.certificates.map((c) => {
                  const days = c.endsAt ? Math.floor((Date.parse(c.endsAt) - Date.parse(s.checkedAt ?? c.endsAt)) / 86_400_000) : null;
                  return (
                    <li key={c.host} className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5 text-sm last:border-b-0">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{c.host}</span>
                        <span className="block text-xs text-text-2">{c.ok ? `until ${c.endsAt?.slice(0, 10)}` : (c.error ?? "could not check")}</span>
                      </span>
                      <LevelBadge level={!c.ok ? "bad" : days !== null && days < 14 ? "warn" : "ok"}>{!c.ok ? "Check" : days !== null && days < 14 ? `${days} days left` : "Fine"}</LevelBadge>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-4 py-3 text-sm text-muted">Checked every hour once the server writes its status.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
