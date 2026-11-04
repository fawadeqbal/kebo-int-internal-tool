import "server-only";
import Link from "next/link";
import { api } from "@/lib/api";
import type { LedgerAgeing } from "@/lib/types-ledger";
import { AgeingTiles } from "./ledger-parts";

/**
 * By how late, from the ledger (To receive: what customers owe; To pay factories: what we owe), above those
 * pages' lists, for those who may see the ledger. Nothing when nothing is open or the ledger cannot be read.
 */
export async function AgeingStrip({ side }: { side: "receivable" | "payable" }) {
  const a = await api.get<LedgerAgeing>("/ledger/ageing", { side }).catch(() => null);
  if (!a || Number(a.total) === 0) return null;
  return (
    <div className="mb-4 flex flex-col gap-1.5">
      <AgeingTiles
        buckets={a.buckets}
        currency={a.mainCurrency}
        label={side === "receivable" ? "What customers owe, by how late" : "What we owe factories, by how late"}
      />
      <p className="px-1 text-xs text-muted">
        By how late, in {a.mainCurrency}, from each plan row&rsquo;s due date.{" "}
        <Link href={`/finance/ledger?view=${side === "receivable" ? "customers" : "factories"}`} className="underline hover:text-text">
          Each {side === "receivable" ? "customer" : "factory"} in the ledger
        </Link>
      </p>
    </div>
  );
}
