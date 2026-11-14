import { requireUser } from "@/lib/session";
import { Board, type Params } from "../views";

export const metadata = { title: "Orders · board" };

/** Sales › Orders, the board view (the same page as the list; one item in the menu): a column per step, each card with what it needs now; ?mine=1 for mine, ?stage=… a step on a phone. */
export default async function OrderBoardPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireUser();
  const sp = await searchParams;
  return <Board sp={sp} mine={sp.mine === "1" || sp.view === "mine"} />;
}
