import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { ordersBoardTarget } from "@/lib/old-addresses";
import { List, type Params } from "./views";

export const metadata = { title: "Orders" };

/** Orders › Orders: the list. The board has its own page (/orders/board); its old address (?view=board, ?stage=…) goes there. */
export default async function OrdersPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireUser();
  const sp = await searchParams;
  const board = ordersBoardTarget(sp);
  if (board) redirect(board);
  return <List sp={sp} mine={sp.mine === "1" || sp.view === "mine"} />;
}
