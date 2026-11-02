import { notFound } from "next/navigation";
import Link from "next/link";
import { isPaperKind, paperDateText, PAPER_LABEL, PAPER_STEP, STEP_PATH } from "@kebo/shared";
import { buttonClass, Card } from "@kebo/ui";
import { api, ApiError } from "@/lib/api";
import { load, requireUser } from "@/lib/session";
import { orderFlowOf, orderOf } from "@/lib/order-data";
import type { CustomerNow } from "@/lib/types-orders";
import type { PaperChecks } from "@/lib/types-papers";
import { optional } from "@/components/print/data";
import { MakePaper } from "@/components/orders/make-paper";
import { paperAction } from "../../../papers-actions";

export async function generateMetadata({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  return { title: `Order · ${isPaperKind(kind) ? PAPER_LABEL[kind].toLowerCase() : "paper"}` };
}

/** The shipping advice's message to the customer: the shipment in a few lines (sent by email or WhatsApp, no mail server needed). */
async function adviceText(id: string, number: string, sender: string) {
  const o = await orderOf(id);
  const [flow, customer] = await Promise.all([
    optional(() => orderFlowOf(id)),
    optional(() => api.get<CustomerNow>(`/customers/${o.customer.id}`)),
  ]);
  const s = flow?.shipping?.shipments[0];
  const contact = customer?.contacts.find((c) => c.isPrimary) ?? customer?.contacts[0] ?? null;
  const lines = [
    `Dear ${contact?.name ?? o.customer.name},`,
    "",
    `Your order ${o.refNo} has been shipped.`,
    s?.vessel ? `Vessel: ${s.vessel}` : null,
    (s?.blNo ?? o.blNo) ? `${s?.mode === "air" ? "AWB" : "B/L"} No.: ${s?.blNo ?? o.blNo}` : null,
    s?.containerNo ? `Container: ${s.containerNo}${s.containerType ? ` (${s.containerType})` : ""}` : null,
    s?.portOfLoading || s?.portOfDischarge
      ? `From ${s?.portOfLoading ?? "China"} to ${s?.portOfDischarge ?? o.portOfDischarge ?? ""}`
      : null,
    s?.etd || s?.eta
      ? [s?.etd ? `ETD ${paperDateText(s.etd)}` : null, s?.eta ? `ETA ${paperDateText(s.eta)}` : null].filter(Boolean).join(" · ")
      : null,
    "",
    `Our shipping advice ${number} is attached.`,
    "",
    "Best regards,",
    sender,
  ].filter((l): l is string => l !== null);
  return {
    email: contact?.email ?? null,
    phone: contact?.whatsapp ?? contact?.phone ?? null,
    subject: `Shipping advice ${number} · order ${o.refNo}`,
    text: lines.join("\n"),
  };
}

/** Make a paper (board OrderV3MakePaper): what it takes from the order, options, Make final / Save as draft, and the paper itself. */
export default async function MakePaperPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; kind: string }>;
  searchParams: Promise<{ ref?: string }>;
}) {
  const [{ id, kind }, sp] = await Promise.all([params, searchParams]);
  if (!isPaperKind(kind)) notFound();
  const me = await requireUser();
  const base = `/orders/${id}`;
  const backHref = `${base}/${STEP_PATH[PAPER_STEP[kind]]}`;
  const ref = sp.ref && /^[\w-]{1,60}$/.test(sp.ref) ? sp.ref : undefined;
  let p: PaperChecks;
  try {
    p = await load(() => api.get<PaperChecks>(`/orders/${id}/papers/${kind}/checks`, ref ? { ref } : undefined));
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 400 || e.status === 422))
      return (
        <Card className="flex flex-col items-start gap-3 p-5">
          <h2 className="text-base font-semibold">{PAPER_LABEL[kind]}</h2>
          <p className="text-sm text-text-2">{e.message}</p>
          <Link href={backHref} className={buttonClass("secondary", "sm")}>
            Back
          </Link>
        </Card>
      );
    throw e;
  }
  const send = kind === "shipping-advice" ? await adviceText(id, p.number, me.name) : undefined;
  return <MakePaper p={p} run={paperAction.bind(null, id, kind, p.ref)} base={base} backHref={backHref} send={send} />;
}
