import { Card, CardBody, CardHeader } from "@kebo/ui";
import { api } from "@/lib/api";
import type { HistoryEntry } from "@/lib/types";
import { HistoryList } from "@/components/common/history-list";

export const metadata = { title: "Inquiry history" };

/** Every change on the deal and its prices, quotation, files and order: who, when, old → new, and why. */
export default async function DealHistory({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entries = await api.get<HistoryEntry[]>("/history", { type: "deal", id });
  return (
    <Card>
      <CardHeader
        title="History"
        description="Every change on this inquiry, its factory prices, quotation, files and order — newest first, with the reason when one was asked."
      />
      <CardBody>
        <HistoryList entries={entries} showArea />
      </CardBody>
    </Card>
  );
}
