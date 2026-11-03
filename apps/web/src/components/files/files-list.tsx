"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Plus, X } from "lucide-react";
import type { FlowStep, OrderFileGroup } from "@kebo/shared";
import { Alert, Button, buttonClass, Card, CardHeader, cn, Input } from "@kebo/ui";
import type { OrderFile, OrderFiles } from "@/lib/types-files";
import { useIsPhone } from "@/components/common/floating";
import { downloadHref, FileRow, guessKind, uploadToOrder, useFileTools } from "./file-tools";

/** Picks files and sends each to the order (to `step`), then refreshes the page. */
export function UploadButton({
  orderId,
  step,
  label = "Upload",
  className,
  variant = "secondary",
  size = "xs",
}: {
  orderId: string;
  step: FlowStep | null;
  label?: string;
  className?: string;
  variant?: "secondary" | "ghost";
  size?: "xs" | "sm";
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const send = (files: FileList | null) =>
    start(async () => {
      setError(null);
      for (const f of [...(files ?? [])]) {
        const r = await uploadToOrder(orderId, f, { step, kind: guessKind(f.name, f.type) });
        if (r.error) return setError(`${f.name}: ${r.error}`);
      }
      router.refresh();
    });
  return (
    <>
      <input ref={input} type="file" multiple hidden onChange={(e) => (send(e.target.files), (e.target.value = ""))} />
      <button type="button" className={cn(buttonClass(variant, size), className)} disabled={busy} onClick={() => input.current?.click()}>
        <Plus aria-hidden /> {busy ? "Sending…" : label}
      </button>
      {error && (
        <span role="alert" className="basis-full text-xs text-bad">
          {error}
        </span>
      )}
    </>
  );
}

/**
 * "Files of this order · n" (Documents & bank): every file of the order once,
 * grouped Customer · Factory · Shipping · Bank · Money with a filter and a
 * search, Download all, Upload, and ticks for many at once (download as one zip,
 * share, attach, delete). A file added anywhere lands here by itself, tagged
 * with where it belongs.
 */
export function FilesOfOrder({ data, step }: { data: OrderFiles; step: FlowStep }) {
  const tools = useFileTools();
  const phone = useIsPhone();
  const [unfolded, setUnfolded] = useState(false);
  const [group, setGroup] = useState<OrderFileGroup | "all">("all");
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.files.filter(
      (f) =>
        (group === "all" || f.group === group) &&
        (!needle ||
          [f.name, f.attachedTo.label, f.note ?? "", f.stepLabel, f.by?.name ?? ""].some((s) => s.toLowerCase().includes(needle))),
    );
  }, [data.files, group, q]);
  const picked = data.files.filter((f) => chosen.has(f.id));
  const pick = (f: OrderFile, on: boolean) =>
    setChosen((s) => {
      const n = new Set(s);
      if (on) n.add(f.id);
      else n.delete(f.id);
      return n;
    });
  const groups = data.groups.filter((g) => g.count > 0);
  // A phone: one line of counts; Open shows the list.
  if (phone && !unfolded)
    return (
      <Card id="files" data-target="files" data-target-card="" className="scroll-mt-24">
        <CardHeader
          title={`Files · ${data.files.length}`}
          actions={
            <Button size="xs" variant="ghost" onClick={() => setUnfolded(true)}>
              Open
            </Button>
          }
        />
        <p className="px-4 py-3 text-xs text-muted">
          {groups.length ? groups.map((g) => `${g.label} ${g.count}`).join(" · ") : "No files yet"}
        </p>
      </Card>
    );
  const seg = (key: OrderFileGroup | "all", label: string, count: number) => (
    <button
      key={key}
      type="button"
      aria-pressed={group === key}
      onClick={() => setGroup(key)}
      className={cn(
        "inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium whitespace-nowrap text-muted transition-colors hover:text-text",
        group === key && "bg-surface text-text shadow-card",
      )}
    >
      {label} · {count}
    </button>
  );
  return (
    <Card id="files" data-target="files" data-target-card="" className="scroll-mt-24">
      <CardHeader title={`Files of this order · ${data.files.length}`} />
      <div className="flex flex-col gap-3 px-4 py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <nav
            aria-label="Files by group"
            className="inline-flex max-w-full overflow-x-auto rounded-lg border border-line bg-surface-2 p-0.5 [scrollbar-width:none]"
          >
            {seg("all", "All", data.files.length)}
            {groups.map((g) => seg(g.key, g.label, g.count))}
          </nav>
          <span className="flex flex-wrap items-center gap-2">
            <Input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search files…"
              aria-label="Search files"
              className="h-8 w-full sm:w-48"
            />
            {data.files.length > 0 && (
              <a href={`/files/orders/${data.orderId}`} className={buttonClass("ghost", "xs")}>
                <Download aria-hidden /> Download all
              </a>
            )}
            {data.canUpload && <UploadButton orderId={data.orderId} step={step} />}
          </span>
        </div>

        {picked.length > 0 && tools && (
          <div
            className="sticky top-14 z-10 flex flex-wrap items-center gap-2 rounded-lg bg-text px-3 py-2 text-sm text-surface"
            role="toolbar"
            aria-label="Chosen files"
          >
            <b className="mr-auto font-semibold">{picked.length} selected</b>
            <button
              type="button"
              className="rounded-md bg-white/10 px-2.5 py-1 text-xs font-medium hover:bg-white/20"
              onClick={() => downloadHref(`/files/orders/${data.orderId}?files=${picked.map((f) => f.id).join(",")}`)}
            >
              Download as zip
            </button>
            <button
              type="button"
              className="rounded-md bg-white/10 px-2.5 py-1 text-xs font-medium hover:bg-white/20"
              onClick={() => tools.open({ kind: "share", files: picked, papers: [] })}
            >
              Share…
            </button>
            {picked.some((f) => f.can.attach) && (
              <button
                type="button"
                className="rounded-md bg-white/10 px-2.5 py-1 text-xs font-medium hover:bg-white/20"
                onClick={() => tools.open({ kind: "attach-many", files: picked })}
              >
                Attach to…
              </button>
            )}
            {picked.some((f) => f.can.remove) && (
              <button
                type="button"
                className="rounded-md bg-white/10 px-2.5 py-1 text-xs font-medium hover:bg-white/20"
                onClick={() => tools.open({ kind: "delete", files: picked })}
              >
                Delete
              </button>
            )}
            <button
              type="button"
              aria-label="Clear the choice"
              className="grid size-7 place-items-center rounded-md hover:bg-white/10"
              onClick={() => setChosen(new Set())}
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        )}

        {shown.length ? (
          (group === "all"
            ? data.groups.filter((g) => shown.some((f) => f.group === g.key))
            : data.groups.filter((g) => g.key === group)
          ).map((g) => {
            const rows = shown.filter((f) => f.group === g.key);
            return (
              <div key={g.key}>
                <p className="mt-1 mb-0.5 text-[11px] font-semibold tracking-wide text-muted uppercase">{g.label}</p>
                <ul>
                  {rows.map((f) => (
                    <FileRow key={f.id} file={f} set={rows} selected={chosen.has(f.id)} onSelect={(on) => pick(f, on)} />
                  ))}
                </ul>
              </div>
            );
          })
        ) : (
          <p className="text-sm text-muted">
            {data.files.length ? "No file matches." : "No files on this order yet. Drop them anywhere on the order's pages, or Upload."}
          </p>
        )}
        <p className="text-xs text-muted">
          A file added on a checklist row, a paper or a payment lands here by itself, tagged with where it belongs.
        </p>
      </div>
    </Card>
  );
}

/** A small alert for a dropped file that could not be kept. */
export function DropError({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed right-4 bottom-4 z-[95] max-w-sm">
      <Alert tone="error">
        <span className="flex items-start gap-2">
          <span className="flex-1">{message}</span>
          <Button size="icon-xs" variant="ghost" aria-label="Close" onClick={onClose}>
            <X aria-hidden />
          </Button>
        </span>
      </Alert>
    </div>
  );
}
