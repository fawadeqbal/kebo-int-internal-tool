import Link from "next/link";
import type { DomainDiagnosis } from "@kebo/shared";
import { cn, linkClass, Notice, subTitleClass } from "@kebo/ui";
import { AuthShell } from "@/app/login/auth-shell";
import { DiagnosisList, DiagnosisVerdict } from "@/components/domains/diagnosis";
import { apiFetch } from "@/lib/api";
import { checkPath, CheckForm, RecordTable } from "../parts";

export const metadata = { title: "Check a domain" };

/** The look-up, or why there is none (a domain that cannot be one, too many checks, the API down). */
async function look(domain: string): Promise<{ d: DomainDiagnosis } | { error: string }> {
  const res = await apiFetch("/platform/public/connect-check", { auth: false, query: { domain } }).catch(() => null);
  if (!res) return { error: "The check could not be made just now. Try again in a minute." };
  const body = await res.json().catch(() => null);
  return res.ok ? { d: body as DomainDiagnosis } : { error: body?.error ?? "The check could not be made just now. Try again in a minute." };
}

/**
 * connect.<BASE_DOMAIN>/check?domain=… : the domain someone is connecting, looked up step by step, with what
 * to fix. A plain link, so it can be sent to whoever manages the DNS.
 */
export default async function ConnectCheckPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const typed = (Array.isArray(sp.domain) ? sp.domain[0] : sp.domain)?.trim() ?? "";
  const action = await checkPath();
  const home = action === "/check" ? "/" : "/connect";
  const r = typed ? await look(typed) : null;
  return (
    <AuthShell wide subtitle="Check a domain">
      <CheckForm action={action} value={typed} label={typed ? "Check again" : "Check the record"} />

      {r && "error" in r && (
        <Notice tone="bad" className="mt-5">
          {r.error}
        </Notice>
      )}

      {r && "d" in r && (
        <div className="mt-6 flex flex-col gap-4">
          <h1 className="text-xl leading-7 font-semibold tracking-tight [overflow-wrap:anywhere]">{r.d.domain}</h1>
          <DiagnosisVerdict d={r.d} />
          <div className="flex flex-col gap-2">
            <h2 className={subTitleClass}>What we looked up</h2>
            <DiagnosisList d={r.d} />
          </div>
          {r.d.verdict !== "right" && (
            <div className="flex flex-col gap-2">
              <h2 className={subTitleClass}>The record to add in {r.d.zone}</h2>
              <RecordTable name={r.d.domain.split(".")[0]} />
            </div>
          )}
          <p className="text-xs text-muted">
            Checked {new Date(r.d.checkedAt).toUTCString()}. A new record can take up to an hour to show everywhere. To send this check to
            someone, copy this page&apos;s address.
          </p>
        </div>
      )}

      <Link href={home} className={cn(linkClass, "mt-6 inline-block text-sm")}>
        How connecting a domain works
      </Link>
    </AuthShell>
  );
}
