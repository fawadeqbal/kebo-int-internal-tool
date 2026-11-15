import { ListPageSkeleton } from "@/components/common/skeletons";

/** The purchase orders list on its way. */
export default function Loading() {
  return <ListPageSkeleton tiles={4} chips={6} selects={2} buttons={1} cols={7} />;
}
