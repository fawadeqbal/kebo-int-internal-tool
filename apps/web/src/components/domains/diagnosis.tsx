import { Check, Info, Minus, X } from "lucide-react";
import { DOMAIN_VERDICT_WORDS, type DomainDiagnosis } from "@kebo/shared";
import { cn, Notice } from "@kebo/ui";

/** One step of a domain's look-up: passed, failed, not reached yet (because an earlier one failed), or only for your information. */
export type StepMark = "ok" | "bad" | "wait" | "info";
export interface DiagnosisStep {
  mark: StepMark;
  label: string;
  /** What the look-up found, as DNS has it. */
  found: string;
}

const list = (xs: string[] | null, failed = "the look-up did not answer") =>
  xs === null ? failed : xs.length ? xs.join(", ") : "none found";

/**
 * A domain's look-up as steps people can read (claude/own-domains-admin-design.md): the domain itself,
 * the record, where it points, where it ends up, who keeps the records. Shared by the platform's company
 * page and connect.<BASE_DOMAIN>'s check.
 */
export function diagnosisSteps(d: DomainDiagnosis): DiagnosisStep[] {
  const name = d.domain.split(".")[0];
  const hasRecord = !!(d.cname?.length || d.addresses?.length);
  const right = d.verdict === "right";
  const steps: DiagnosisStep[] = [
    {
      mark: d.zoneAddresses === null ? "wait" : d.zoneAddresses.length ? "ok" : "info",
      label: `${d.zone} answers`,
      found: d.zoneAddresses?.length
        ? `${d.zone} → ${d.zoneAddresses.join(", ")}`
        : `${d.zone}: ${list(d.zoneAddresses, "the look-up did not answer")}`,
    },
    {
      mark: d.cname === null && d.addresses === null ? "wait" : hasRecord ? "ok" : "bad",
      label: `A record called ${name} exists`,
      found: hasRecord
        ? d.cname?.length
          ? `${d.domain} CNAME ${d.cname.join(", ")}`
          : `${d.domain} → ${d.addresses!.join(", ")}`
        : `${d.domain}: does not exist`,
    },
    {
      mark: right ? "ok" : hasRecord ? "bad" : "wait",
      label: `Points to ${d.target}`,
      found: right
        ? d.target
        : hasRecord
          ? d.cname?.length
            ? `points to ${d.cname.join(", ")}`
            : "no CNAME: an address record instead"
          : "not checked yet: no record",
    },
    {
      mark: !d.addresses?.length ? "wait" : right ? "ok" : "bad",
      label: "Reaches our server, with no proxy in between",
      found: d.addresses?.length
        ? `${d.domain} → ${d.addresses.join(", ")}${right ? "" : ` (ours: ${list(d.ourAddresses)})`}${d.verdict === "proxied" ? " · Cloudflare's proxy" : ""}`
        : "not checked yet: no record",
    },
    {
      mark: "info",
      label: `Where ${d.zone}'s records are kept`,
      found: d.nameservers?.length ? `${d.nameservers.join(", ")}${d.provider ? ` → ${d.provider}` : ""}` : list(d.nameservers),
    },
  ];
  return steps;
}

const MARK = {
  ok: { icon: Check, cls: "bg-ok text-white", word: "Passed" },
  bad: { icon: X, cls: "bg-bad text-white", word: "Failed" },
  wait: { icon: Minus, cls: "bg-surface-3 text-text-2", word: "Not reached" },
  info: { icon: Info, cls: "bg-info-soft text-info", word: "For your information" },
} as const;

/** The verdict in a sentence and what to do, for the platform admin or whoever looks after the DNS. */
export function DiagnosisVerdict({ d, who = "you" }: { d: DomainDiagnosis; who?: "you" | "client" }) {
  const w = DOMAIN_VERDICT_WORDS[d.verdict];
  const tone = d.verdict === "right" ? "ok" : d.verdict === "unknown" ? "neutral" : d.verdict === "no_record" ? "todo" : "bad";
  const ask = who === "client" && d.verdict !== "right" && d.verdict !== "unknown";
  const where = d.verdict === "no_record" && d.provider ? ` For ${d.zone} that is ${d.provider}.` : "";
  return (
    <Notice tone={tone} title={`${w.title}.`}>
      {ask ? `Ask the client to ${w.next.charAt(0).toLowerCase()}${w.next.slice(1)}` : w.next}
      {where}
    </Notice>
  );
}

/** The steps as a list: a mark, what was checked and what was found. */
export function DiagnosisList({ d, className }: { d: DomainDiagnosis; className?: string }) {
  return (
    <ul
      className={cn("divide-y divide-line overflow-hidden rounded-lg border border-line", className)}
      aria-label={`Look-up of ${d.domain}`}
    >
      {diagnosisSteps(d).map((s) => {
        const m = MARK[s.mark];
        const Icon = m.icon;
        return (
          <li key={s.label} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
            <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full", m.cls)} title={m.word}>
              <Icon className="size-3" strokeWidth={3} aria-hidden />
              <span className="sr-only">{m.word}:</span>
            </span>
            <span className="min-w-[12rem] flex-1 font-medium">{s.label}</span>
            <span className="min-w-0 flex-[2_1_16rem] font-mono text-md text-text-2 [overflow-wrap:anywhere]">{s.found}</span>
          </li>
        );
      })}
    </ul>
  );
}
