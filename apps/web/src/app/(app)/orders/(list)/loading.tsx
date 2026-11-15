import { ListPageSkeleton } from "@/components/common/skeletons";

/** The orders list on its way. */
export default function Loading() {
  return <ListPageSkeleton tiles={5} chips={8} selects={2} buttons={1} views cols={8} />;
}
