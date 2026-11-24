import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { PaymentPaper } from "@kebo/shared";
import { api } from "@/lib/api";
import { docBrand, load } from "@/lib/session";
import { PaperSheet } from "@/components/print/paper";
import { PrintToolbar } from "@/components/print/toolbar";
import { backTo } from "@/components/print/data";
import { UUID } from "@/lib/ids";

/** The kinds that print a voucher; a customer payment prints its receipt from the order's papers. */
const KINDS = ["supplier", "expense"] as const;

async function getPaper(kind: string, id: string) {
  if (!(KINDS as readonly string[]).includes(kind) || !UUID.test(id)) notFound();
  return load(() => api.get<PaymentPaper>(`/treasury/payments/${kind}/${id}/paper`));
}

export async function generateMetadata({ params }: { params: Promise<{ kind: string; id: string }> }): Promise<Metadata> {
  const { kind, id } = await params;
  return { title: (await getPaper(kind, id)).title };
}

/** A supplier payment's or an expense's voucher, in Kebo's one document template (the receipt's). */
export default async function PaymentVoucherPrint({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string; id: string }>;
  searchParams: Promise<{ back?: string }>;
}) {
  const [{ kind, id }, sp] = await Promise.all([params, searchParams]);
  const p = await getPaper(kind, id);
  return (
    <>
      <PrintToolbar title={p.title} backHref={backTo(sp.back, `/payments/${kind}/${id}`)} pdfHref={`/pdf/voucher-${kind}/${id}`} />
      <PaperSheet doc={p.doc} brand={await docBrand()} watermark={null} />
    </>
  );
}
