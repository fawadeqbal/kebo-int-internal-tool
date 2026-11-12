"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Alert, Button, Card, CardBody, CardHeader, Input, StatusBadge, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { orderLineAction } from "@/app/(app)/orders/actions";

export interface ReceivedLine {
  id: string;
  no: string;
  description: string;
  quantity: string;
  unit: string;
  receivedQty: string | null;
  /** As read ("18 Dec 2026"). */
  receivedOn: string | null;
}

const num = (v: string | null) => Number(v ?? 0) || 0;

/**
 * "Goods ready at the factory" (board OrderGoods): each line's ordered and received quantity, the day
 * it came in and whether it is all here; All received fills every line; Save keeps what changed.
 */
export function GoodsReceived({ orderId, lines, canEdit, today }: { orderId: string; lines: ReceivedLine[]; canEdit: boolean; today: string }) {
  const router = useRouter();
  const start = Object.fromEntries(lines.map((l) => [l.id, l.receivedQty === null ? "" : String(Number(l.receivedQty))]));
  const [qty, setQty] = useState<Record<string, string>>(start);
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useTransition();
  const changed = lines.filter((l) => (qty[l.id] ?? "") !== (start[l.id] ?? ""));
  const short = lines.filter((l) => num(qty[l.id] ?? null) < num(l.quantity));

  const save = () =>
    run(async () => {
      setError(null);
      for (const l of changed) {
        const v = qty[l.id]?.trim() ?? "";
        const r = await orderLineAction(orderId, l.id, { set: "received", receivedQty: v === "" ? null : v, ...(v && !l.receivedOn ? { receivedOn: today } : {}) });
        if (!r.ok) {
          setError(`${l.description}: ${r.message}`);
          return;
        }
      }
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-4">
      {short.length > 0 && lines.some((l) => num(qty[l.id] ?? null) > 0) && (
        <Alert tone="warning">
          <strong>
            {short.length} line{short.length === 1 ? "" : "s"} short.
          </strong>{" "}
          {short.map((l) => l.description).join(", ")} not ready. Ask the factory, or ship without {short.length === 1 ? "it" : "them"} and send later.
        </Alert>
      )}
      <Card className="overflow-hidden">
        <CardHeader
          title="Goods ready at the factory"
          actions={
            canEdit && short.length > 0 ? (
              <Button variant="secondary" onClick={() => setQty(Object.fromEntries(lines.map((l) => [l.id, String(num(l.quantity))])))}>
                <Check aria-hidden /> All received
              </Button>
            ) : undefined
          }
        />
        <Table className="min-w-[640px]">
          <THead>
            <tr>
              <Th>Line</Th>
              <Th className="text-right">Ordered</Th>
              <Th className="w-32 text-right">Received</Th>
              <Th>Received on</Th>
              <Th />
            </tr>
          </THead>
          <tbody>
            {lines.map((l) => {
              const got = num(qty[l.id] ?? null);
              const all = got >= num(l.quantity);
              return (
                <Tr key={l.id}>
                  <Td className="font-semibold">
                    {l.description}
                    {l.no.includes(".") && <span className="block text-xs font-normal text-muted">part of {l.no.split(".")[0]}</span>}
                  </Td>
                  <Td className="text-right whitespace-nowrap tabular">
                    {Number(l.quantity).toLocaleString("en-US")} {l.unit}
                  </Td>
                  <Td className="text-right">
                    {canEdit ? (
                      <Input
                        aria-label={`Received of ${l.description}`}
                        inputMode="decimal"
                        className="h-[38px] text-right tabular"
                        value={qty[l.id] ?? ""}
                        onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))}
                      />
                    ) : (
                      <span className="tabular">{got}</span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">{l.receivedOn ?? (got > 0 ? "today" : "—")}</Td>
                  <Td>
                    {all ? <StatusBadge meaning="ok">All here</StatusBadge> : got > 0 ? <StatusBadge meaning="warn">Part here</StatusBadge> : <StatusBadge meaning="bad">Missing</StatusBadge>}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
      {canEdit && (
        <Card>
          <CardBody className="flex flex-col gap-3">
            {error && <p className="text-sm text-bad">{error}</p>}
            <div className="flex items-center gap-2.5 border-t border-line pt-4">
              <Button onClick={save} disabled={!changed.length || pending}>
                <Check aria-hidden /> {pending ? "Saving…" : "Save"}
              </Button>
              <Button variant="ghost" onClick={() => setQty(start)} disabled={!changed.length || pending}>
                Cancel
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
