import { connectTarget, type DomainDiagnosis } from "@kebo/shared";
import { Card, StatusBadge } from "@kebo/ui";
import { DiagnosisList, DiagnosisVerdict } from "@/components/domains/diagnosis";
import { platformApi } from "@/lib/api";
import { date, timeAgo } from "@/lib/format";
import { CopyText, PlatformCheckDomain, PlatformConnectDomain, PlatformRemoveDomain } from "./domain-forms";
import type { PlatformDomainView } from "./domain-types";

const STATUS = {
  waiting: { meaning: "warn", label: "Waiting for the record" },
  connected: { meaning: "ok", label: "Connected" },
  lost: { meaning: "bad", label: "Lost" },
} as const;

/** The ready message for whoever looks after the client's DNS: the record, and the link that checks it. */
function instructions(v: PlatformDomainView, d: DomainDiagnosis | null) {
  const r = v.record!;
  const base = process.env.BASE_DOMAIN;
  const where = d?.provider ? ` (for ${r.zone} that is ${d.provider})` : "";
  return [
    `Hi, to open RFQ Desk at ${v.domain}, please add this record where ${r.zone}'s DNS is managed${where}:`,
    "",
    `Type: ${r.type}`,
    `Name / Host: ${r.name}   (only this part, not the full address)`,
    `Value / Points to: ${r.value}`,
    "TTL: leave the default",
    "",
    "If the domain is on Cloudflare, set the record to DNS only (grey cloud).",
    ...(base ? ["", `Check it any time here: https://${connectTarget(base)}/check?domain=${encodeURIComponent(v.domain!)}`] : []),
  ].join("\n");
}

/**
 * Platform › Companies › a company › Details, under "Web address" (claude/own-domains-admin-design.md):
 * the company's own domain beside its address under ours, with why it is not connected yet (the look-up
 * step by step), Check now, the ready message for the client, add and remove. Only where own domains are on.
 */
export async function CompanyDomainCard({ id, name, live }: { id: string; name: string; live: boolean }) {
  const v = await platformApi.get<PlatformDomainView>(`/companies/${id}/domain`).catch(() => null);
  if (!v?.enabled) return null;
  const { domain, status, ours, diagnosis: d } = v;
  const s = status ? STATUS[status] : null;
  const actions = !live ? undefined : !domain ? <PlatformConnectDomain id={id} name={name} ours={ours} /> : <PlatformCheckDomain id={id} />;
  return (
    <Card id="own-domain" aria-labelledby="own-domain-title" className="scroll-mt-20">
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 id="own-domain-title" className="text-sm font-semibold text-text">
            Their own domain
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            {!domain
              ? `none: their people use ${ours}`
              : status === "connected"
                ? `their address now; ${ours} sends people on to it`
                : `not in use yet: their people are at ${ours}`}
          </p>
        </div>
        {actions}
      </div>
      {domain && (
        <div className="flex flex-col gap-4 px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {status === "connected" ? (
              <a href={`https://${domain}`} className="font-mono text-base font-medium text-primary hover:underline">
                {domain}
              </a>
            ) : (
              <span className="font-mono text-base font-medium">{domain}</span>
            )}
            {s && <StatusBadge meaning={s.meaning}>{s.label}</StatusBadge>}
            <span className="text-xs text-muted">
              {[
                status === "connected" && v.since ? `since ${date(v.since)}` : null,
                status === "lost" && v.lostAt ? `record last seen ${date(v.lostAt)}` : null,
                v.checkedAt ? `checked ${timeAgo(v.checkedAt)}` : "not checked yet",
                status === "waiting" ? "looked up every 10 minutes" : status === "lost" ? "looked up every hour" : "looked up once a day",
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>

          {d && (
            <>
              <DiagnosisVerdict d={d} who="client" />
              <div className="flex flex-col gap-2">
                <h3 className="text-[13px] font-semibold text-text-2">What the look-up found just now</h3>
                <DiagnosisList d={d} />
              </div>
            </>
          )}

          {v.record && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-surface-2 px-3 py-2.5 text-sm">
              <span className="text-xs text-muted">The record they add in {v.record.zone}</span>
              <span className="font-mono [overflow-wrap:anywhere]">
                {v.record.type} · {v.record.name} · {v.record.value}
              </span>
              <span className="ml-auto">
                <CopyText text={v.record.value} label="Copy the value" />
              </span>
            </div>
          )}

          {live && (
            <div className="flex flex-wrap items-center gap-2">
              {status !== "connected" && (
                <CopyText text={instructions(v, d)} label="Copy the message for the client" done="Message copied" />
              )}
              <PlatformRemoveDomain id={id} domain={domain} ours={ours} connected={status === "connected"} />
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
