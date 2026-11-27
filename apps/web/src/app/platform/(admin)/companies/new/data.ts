import { platformApi } from "@/lib/api";
import type { LeadDetail, Plan } from "@/lib/types-platform";
import type { Prefill } from "./form";
import { dataOf, isFailed, part } from "@/lib/part";

/** What New company or demo needs, from ?lead= (a client inquiry) and ?kind= (client or demo). */
export async function newCompanyData(sp: { lead?: string; kind?: string }) {
  const [plans, leadPart] = await Promise.all([
    platformApi.get<Plan[]>("/plans"),
    sp.lead ? part("the client inquiry to start from", () => platformApi.get<LeadDetail>(`/leads/${sp.lead}`)) : null,
  ]);
  // Not read: the form starts empty, and says why (leadFailed).
  const lead = dataOf(leadPart);
  const prefill: Prefill = {
    kind: sp.kind === "demo" ? "demo" : sp.kind === "client" ? "client" : lead ? "demo" : "client",
    name: lead?.companyName,
    adminName: lead?.name,
    adminEmail: lead?.email,
    leadId: lead?.id,
  };
  return { plans, lead, prefill, leadFailed: isFailed(leadPart) ? leadPart.what : null };
}
