import { redirect } from "next/navigation";
import { newInquiryHref } from "../inquiry-windows";

/** The old address of the New inquiry page: it is a window over the Inquiries list now. ?customer=<id> starts with that customer. */
export default async function NewDealPage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const sp = await searchParams;
  redirect(newInquiryHref(sp.customer));
}
