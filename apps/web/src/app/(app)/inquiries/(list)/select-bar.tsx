"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Clock, FileSpreadsheet, PauseCircle, UserRound } from "lucide-react";
import { addDays } from "@kebo/utils";
import { REASON_CHOICES } from "@kebo/shared";
import { Button, buttonClass, cn, Field, Input } from "@kebo/ui";
import { toast } from "@kebo/ui/client";
import { Modal } from "@/components/common/dialog";
import { useExcelAllowed } from "@/components/common/features";
import { FloatingMenu } from "@/components/common/floating";
import { ReasonDialog } from "@/components/edits/edits";
import { SelectBar, useSelection } from "@/components/lists/selection";
import { manyInquiriesAction, type ManyInquiries } from "../actions";

/** What the bar needs to know of each row on the page. */
export interface BarRow {
  id: string;
  refNo: string;
  assigned: boolean;
  open: boolean;
}

const BTN = "h-8 border-primary-line px-2.5 text-[13px]";

/**
 * Select's bar on the inquiries list (design "list pages" 18 Nov): Responsible person, Next follow-up, Put on hold
 * and Export to Excel for the ticked ones. Taking work from someone and putting on hold ask why once, for all.
 */
export function InquirySelectBar({ rows, people, meId, canAssign, today }: { rows: BarRow[]; people: { id: string; name: string }[]; meId: string; canAssign: boolean; today: string }) {
  const s = useSelection();
  const router = useRouter();
  const excel = useExcelAllowed();
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [why, setWhy] = useState<null | { what: ManyInquiries; title: string; choices: readonly string[]; save: string }>(null);
  const [follow, setFollow] = useState(false);
  const [title, setTitle] = useState("Follow up");
  const [day, setDay] = useState(addDays(today, 1));
  const anchor = useRef<HTMLButtonElement>(null);
  const byId = new Map(rows.map((r) => [r.id, r]));

  const run = async (ticked: string[], what: ManyInquiries, said: (n: number) => string) => {
    setBusy(true);
    const r = await manyInquiriesAction(ticked, what);
    setBusy(false);
    setWhy(null);
    setFollow(false);
    const failed = r.failed.map((f) => `${byId.get(f.id)?.refNo ?? "One"}: ${f.message}`);
    toast({ message: r.done ? said(r.done) : "Nothing was changed.", kind: failed.length ? (r.done ? "part" : "fail") : undefined, detail: failed.join(" · ") || undefined });
    s.stop();
    router.refresh();
  };
  const n = (k: number) => `${k} ${k === 1 ? "inquiry" : "inquiries"}`;

  return (
    <SelectBar>
      {(ticked) => {
        const assignTo = (assigneeId: string | null, name: string) => {
          setMenu(false);
          const what: ManyInquiries = { kind: "assign", assigneeId };
          const said = (k: number) => (assigneeId ? `${n(k)} given to ${name}` : `${n(k)} with nobody responsible now`);
          // Taking work from someone needs a reason (one for all of them); first assignment does not.
          if (ticked.some((id) => byId.get(id)?.assigned))
            setWhy({ what, title: `Why give ${n(ticked.length)} to ${assigneeId ? name : "nobody"}?`, choices: REASON_CHOICES.reassign, save: assigneeId ? `Give to ${name}` : "Take off" });
          else void run(ticked, what, said);
        };
        const open = ticked.filter((id) => byId.get(id)?.open);
        return (
          <>
            {canAssign && (
              <>
                <Button ref={anchor} variant="secondary" size="sm" className={BTN} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)} disabled={busy}>
                  <UserRound aria-hidden /> Responsible person <ChevronDown className="opacity-70" aria-hidden />
                </Button>
                {menu && (
                  <FloatingMenu anchor={() => anchor.current} onClose={() => setMenu(false)} label="Responsible person" align="start" width={240}>
                    {[{ id: meId, name: "Me" }, ...people.filter((p) => p.id !== meId), { id: "", name: "Nobody" }].map((p) => (
                      <button
                        key={p.id || "none"}
                        type="button"
                        role="menuitem"
                        onClick={() => assignTo(p.id || null, p.id === meId ? (people.find((x) => x.id === meId)?.name ?? "you") : p.name)}
                        className="flex min-h-9 w-full items-center rounded-md px-2.5 text-left text-sm text-text hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
                      >
                        {p.name}
                      </button>
                    ))}
                  </FloatingMenu>
                )}
              </>
            )}
            <Button variant="secondary" size="sm" className={BTN} onClick={() => setFollow(true)} disabled={busy}>
              <Clock aria-hidden /> Next follow-up
            </Button>
            {open.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                className={BTN}
                disabled={busy}
                onClick={() => setWhy({ what: { kind: "hold", reason: "" }, title: `Why put ${n(open.length)} on hold?`, choices: REASON_CHOICES.hold, save: `Put ${open.length} on hold` })}
              >
                <PauseCircle aria-hidden /> Put on hold
              </Button>
            )}
            {excel && (
              <a href={`/sheets/export/inquiries?ids=${ticked.join(",")}`} download className={cn(buttonClass("secondary", "sm"), BTN)}>
                <FileSpreadsheet aria-hidden /> Export to Excel
              </a>
            )}

            {why && (
              <ReasonDialog
                title={why.title}
                changes={ticked.map((id) => byId.get(id)?.refNo ?? id)}
                choices={why.choices}
                busy={busy}
                saveLabel={why.save}
                cancelLabel="Back"
                sub="The reason is kept in each inquiry's history."
                onCancel={() => setWhy(null)}
                onSave={(reason) => {
                  const what = why.what.kind === "hold" ? { kind: "hold" as const, reason } : { ...why.what, reason };
                  const targets = why.what.kind === "hold" ? open : ticked;
                  void run(targets, what, (k) => (what.kind === "hold" ? `${n(k)} on hold` : `${n(k)} moved`));
                }}
              />
            )}
            {follow && (
              <Modal
                title={`Next follow-up for ${n(ticked.length)}`}
                onClose={() => setFollow(false)}
                busy={busy}
                footer={
                  <Button disabled={busy || !title.trim() || !day} onClick={() => void run(ticked, { kind: "followUp", title: title.trim(), dueOn: day }, (k) => `Follow-up set on ${n(k)}`)}>
                    {busy ? "Saving…" : `Set on ${n(ticked.length)}`}
                  </Button>
                }
              >
                <div className="grid gap-3.5 sm:grid-cols-2">
                  <Field label="What to do" htmlFor="many-fu-title" required className="sm:col-span-2">
                    <Input id="many-fu-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
                  </Field>
                  <Field label="Day" htmlFor="many-fu-day" required>
                    <Input id="many-fu-day" type="date" value={day} min={today} onChange={(e) => setDay(e.target.value)} />
                  </Field>
                </div>
              </Modal>
            )}
          </>
        );
      }}
    </SelectBar>
  );
}
