import { ListPageSkeleton } from "@/components/common/skeletons";

/** The activity log on its way. */
export default function Loading() {
  return <ListPageSkeleton tiles={0} chips={0} selects={2} buttons={0} cols={4} />;
}
