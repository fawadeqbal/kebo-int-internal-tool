import { RouteWindow } from "@/components/common/route-window";
import { numberHint, RecordPayment, type Search } from "../../../payments/new/record";

/** Record payment, opened from a button anywhere: a window over the page you are on. */
export default async function RecordPaymentWindow({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  return (
    <RouteWindow title="Record payment" description={numberHint(sp.kind)} size="xl">
      <RecordPayment sp={sp} inWindow />
    </RouteWindow>
  );
}
