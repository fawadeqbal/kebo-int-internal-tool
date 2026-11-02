import "server-only";
import Link from "next/link";
import { Check } from "lucide-react";
import { paperDone, type FlowStep } from "@kebo/shared";
import { buttonClass, Card, CardHeader, cn } from "@kebo/ui";
import { orderFilesOf, orderPapersOf } from "@/lib/order-data";
import { optional } from "@/components/print/data";
import { StepFilesCard } from "@/components/files/files-list";

/**
 * "Papers of this step" (Documents v3): a pointer, not a copy. One line of
 * chips — ✓ made, uploaded or kept elsewhere, • still missing or to make —
 * each opening the paper in Documents › Papers, where every paper lives once.
 * Reads GET /orders/:id/papers.
 */
export async function StepPapers({ id, step }: { id: string; dealId?: string; step: FlowStep }) {
  const papers = await optional(() => orderPapersOf(id));
  if (!papers) return null;
  const rows = papers.papers.filter((r) => r.step === step);
  if (!rows.length) return null;
  const href = `/orders/${id}/documents?tab=all#papers`;
  return (
    <Card>
      <CardHeader
        title="Papers of this step"
        actions={
          <Link href={href} className={buttonClass("ghost", "xs")}>
            Open Papers
          </Link>
        }
      />
      <ul className="flex flex-wrap gap-x-4 gap-y-2 px-4 py-3.5" aria-label="Papers of this step">
        {rows.map((r) => {
          const done = paperDone(r.state);
          const what = done
            ? r.number
              ? r.number.replace(/^([A-Z]+)-\d{4}-/, "$1-")
              : r.stateLabel.toLowerCase()
            : r.state === "miss"
              ? "missing"
              : r.stateLabel.toLowerCase();
          return (
            <li key={r.key}>
              <Link href={href} className="inline-flex items-center gap-1.5 text-sm hover:text-primary">
                {done ? (
                  <Check className="size-3.5 text-ok" strokeWidth={3} aria-label="Ready" />
                ) : (
                  <span aria-label="Open" className={cn("size-1.5 rounded-full", r.state === "miss" ? "bg-warn" : "bg-line-strong")} />
                )}
                <span>{r.label}</span>
                <span className="text-xs text-muted tabular">{what}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** The step's "Files" side card: the order's files that belong to this step, with the same tools as everywhere. */
export async function StepFilesSide({ id, step }: { id: string; step: FlowStep }) {
  const files = await optional(() => orderFilesOf(id));
  if (!files) return null;
  return <StepFilesCard files={files.files.filter((f) => f.step === step)} orderId={id} step={step} canUpload={files.canUpload} />;
}
