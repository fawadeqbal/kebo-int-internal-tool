import { CircleAlert, CircleCheck, KeyRound } from "lucide-react";
import { SIGN_IN_RESULT_LABEL } from "@kebo/shared";
import { cn, PhoneList, PhoneRow, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { dateTime, timeAgo } from "@/lib/format";
import type { SignInRow } from "@/lib/types-people";

const ICON = { ok: CircleCheck, wait: KeyRound, bad: CircleAlert };
const kindOf = (r: SignInRow["result"]) => (r === "signed_in" ? "ok" : r === "code_needed" ? "wait" : "bad");

/**
 * The sign-in history, right and wrong attempts, newest first: the one list table on a laptop and phone rows on a
 * phone (canvas board "One list page for all 25 lists"). `showPerson` for Security (everyone's).
 */
export function SignInList({ rows, showPerson = false }: { rows: SignInRow[]; showPerson?: boolean }) {
  const result = (r: SignInRow) => {
    const kind = kindOf(r.result);
    const Icon = ICON[kind];
    return (
      <span className={cn("inline-flex items-center gap-2 font-medium", kind === "bad" && "text-bad")}>
        <Icon className={cn("size-4 shrink-0", kind === "ok" ? "text-ok" : kind === "wait" ? "text-muted" : "text-bad")} aria-hidden />
        {SIGN_IN_RESULT_LABEL[r.result]}
        {r.detail && <span className="font-normal text-text-2">{r.detail}</span>}
      </span>
    );
  };
  const when = (r: SignInRow) => (
    <time dateTime={r.at} title={dateTime(r.at)} className="whitespace-nowrap tabular">
      {timeAgo(r.at)}
    </time>
  );
  return (
    <>
      <div className="max-sm:hidden">
        <Table aria-label="Sign-ins">
          <THead>
            <tr>
              <Th>What happened</Th>
              {showPerson && <Th>Who</Th>}
              <Th>Device</Th>
              <Th>From</Th>
              <Th className="text-right">When</Th>
            </tr>
          </THead>
          <tbody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td>{result(r)}</Td>
                {showPerson && (
                  <Td>
                    {r.user ? r.user.name : r.email}
                    {r.user && <span className="block text-xs text-muted">{r.email}</span>}
                  </Td>
                )}
                <Td className="text-text-2">{r.device}</Td>
                <Td className="text-text-2 tabular">{r.ip}</Td>
                <Td className="text-right text-text-2">{when(r)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
      <PhoneList label="Sign-ins">
        {rows.map((r) => (
          <PhoneRow
            key={r.id}
            title={result(r)}
            line={[showPerson ? (r.user ? r.user.name : r.email) : null, r.device, r.ip].filter(Boolean).join(" · ")}
            figure={when(r)}
          />
        ))}
      </PhoneList>
    </>
  );
}
