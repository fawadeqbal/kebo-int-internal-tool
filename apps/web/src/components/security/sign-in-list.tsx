import { CircleAlert, CircleCheck, KeyRound } from "lucide-react";
import { SIGN_IN_RESULT_LABEL } from "@kebo/shared";
import { cn } from "@kebo/ui";
import { dateTime, timeAgo } from "@/lib/format";
import type { SignInRow } from "@/lib/types-people";

const ICON = { ok: CircleCheck, wait: KeyRound, bad: CircleAlert };
const kindOf = (r: SignInRow["result"]) => (r === "signed_in" ? "ok" : r === "code_needed" ? "wait" : "bad");

/** The sign-in history: right and wrong attempts, newest first. `showPerson` for Security (everyone's). */
export function SignInList({ rows, showPerson = false }: { rows: SignInRow[]; showPerson?: boolean }) {
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => {
        const kind = kindOf(r.result);
        const Icon = ICON[kind];
        return (
          <li key={r.id} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-0.5 px-4 py-2.5 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
            <Icon className={cn("mt-0.5 size-4", kind === "ok" ? "text-ok" : kind === "wait" ? "text-muted" : "text-bad")} aria-hidden />
            <div className="min-w-0 text-sm">
              <p className={cn("font-medium", kind === "bad" && "text-bad")}>
                {SIGN_IN_RESULT_LABEL[r.result]}
                {r.detail && <span className="font-normal text-text-2"> {r.detail}</span>}
              </p>
              <p className="truncate text-xs text-muted">
                {showPerson && <span className="text-text-2">{r.user ? r.user.name : r.email}</span>}
                {showPerson && r.user && <span> ({r.email})</span>}
                {showPerson && " · "}
                {r.device} · {r.ip}
              </p>
            </div>
            <time dateTime={r.at} title={dateTime(r.at)} className="col-start-2 text-xs whitespace-nowrap text-muted tabular sm:col-start-3 sm:text-right">
              {timeAgo(r.at)}
            </time>
          </li>
        );
      })}
    </ul>
  );
}
