"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { FLOW_STEPS, STEP_PATH, type FlowStep } from "@kebo/shared";
import { DropError } from "./files-list";
import { guessKind, uploadToOrder } from "./file-tools";

const stepOfPath = (path: string): FlowStep | null => {
  const seg = path.split("/")[3] ?? "";
  return FLOW_STEPS.find((s) => STEP_PATH[s] === seg) ?? null;
};

/**
 * Drop anywhere on an order's pages: the overlay says where the files go.
 * Dropped on a checklist row or a paper (an element with data-drop-attach),
 * they are attached there; anywhere else they become that step's files (on the
 * Overview and History: the order's files without a step).
 */
export function OrderDrop({ orderId, refNo }: { orderId: string; refNo: string }) {
  const router = useRouter();
  const path = usePathname();
  const [over, setOver] = useState<{ label: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const depth = useRef(0);

  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");
    const targetOf = (e: DragEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>("[data-drop-attach]");
      return el ? { attachTo: el.dataset.dropAttach!, label: el.dataset.dropLabel ?? "there" } : null;
    };
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current++;
      e.preventDefault();
    };
    const move = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const t = targetOf(e);
      const step = stepOfPath(path);
      setOver({ label: t ? `attached to ${t.label}` : step ? "kept with this step's files" : "kept with the order's files" });
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setOver(null);
    };
    const drop = async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setOver(null);
      const files = [...(e.dataTransfer?.files ?? [])];
      if (!files.length) return;
      const t = targetOf(e);
      const step = stepOfPath(path);
      setError(null);
      for (const [i, f] of files.entries()) {
        setBusy(`Sending ${f.name}${files.length > 1 ? ` (${i + 1} of ${files.length})` : ""}…`);
        // One file per paper or item: the first goes there, the rest to the step.
        const r = await uploadToOrder(orderId, f, { step, kind: guessKind(f.name, f.type), attachTo: i === 0 ? t?.attachTo : undefined });
        if (r.error) {
          setError(`${f.name}: ${r.error}`);
          break;
        }
      }
      setBusy(null);
      router.refresh();
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", move);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", move);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [orderId, path, router]);

  return (
    <>
      {over && (
        <div
          className="pointer-events-none fixed inset-3 z-[85] flex items-end justify-center rounded-2xl border-2 border-dashed border-primary bg-primary-soft/60 p-6 sm:inset-6"
          aria-hidden
        >
          <div className="rounded-xl bg-surface px-5 py-3 text-center shadow-pop">
            <p className="text-base font-semibold text-primary tabular">Drop to add to {refNo}</p>
            <p className="mt-0.5 text-xs text-text-2">
              {over.label === "kept with this step's files" || over.label === "kept with the order's files"
                ? `Dropped on a checklist row or a paper, it's attached there; here it is ${over.label}.`
                : `It will be ${over.label}.`}
            </p>
          </div>
        </div>
      )}
      {busy && (
        <div role="status" className="fixed right-4 bottom-4 z-[95] rounded-lg border border-line bg-surface px-4 py-2 text-sm shadow-pop">
          {busy}
        </div>
      )}
      {error && <DropError message={error} onClose={() => setError(null)} />}
    </>
  );
}
