import { ListPageSkeleton } from "@/components/common/skeletons";

/** The ledger on its way. */
export default function Loading() {
  return <ListPageSkeleton segment tiles={0} chips={0} selects={2} buttons={1} cols={6} />;
}
