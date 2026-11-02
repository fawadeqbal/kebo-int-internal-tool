import "server-only";
import { STEP_PATH, type FlowStep } from "@kebo/shared";
import { orderPapersOf } from "@/lib/order-data";
import { optional } from "@/components/print/data";
import { PapersCard } from "@/components/orders/papers-card";
import { addDocumentAction, updateDocumentAction } from "../flow-actions";

/**
 * The "Papers" card of a step page: the papers of that step (or, on Documents
 * & bank, the paper set the shipment needs) with where each stands and its
 * button. Reads GET /orders/:id/papers.
 */
export async function StepPapers({
  id,
  dealId,
  step,
  variant = "side",
  title,
  description,
  outsideSet,
}: {
  id: string;
  dealId: string;
  step: FlowStep;
  variant?: "side" | "main";
  title?: string;
  description?: string;
  /** Documents & bank's view: only the papers outside the paper set (LC papers, the cover letter); the set has its own card. */
  outsideSet?: boolean;
}) {
  const papers = await optional(() => orderPapersOf(id));
  if (!papers) return null;
  const rows =
    step === "documents"
      ? papers.papers.filter((r) => (outsideSet ? !r.inSet && r.step === "documents" : r.inSet || r.step === "documents"))
      : papers.papers.filter((r) => r.step === step);
  return (
    <PapersCard
      rows={rows}
      base={`/orders/${id}`}
      dealId={dealId}
      canMake={papers.canMake}
      canRecord={papers.canRecord}
      addAction={addDocumentAction.bind(null, id)}
      updateActions={Object.fromEntries(rows.filter((r) => r.doc).map((r) => [r.doc!.id, updateDocumentAction.bind(null, id, r.doc!.id)]))}
      variant={variant}
      title={title}
      description={description}
      back={`/orders/${id}/${STEP_PATH[step]}`}
    />
  );
}
