import { ListPageSkeleton } from "@/components/common/skeletons";

/** Approvals on its way. */
export default function Loading() {
  return <ListPageSkeleton tiles={3} chips={2} selects={1} buttons={1} cols={9} />;
}
