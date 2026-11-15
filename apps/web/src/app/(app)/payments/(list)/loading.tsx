import { ListPageSkeleton } from "@/components/common/skeletons";

/** The payments list on its way. */
export default function Loading() {
  return <ListPageSkeleton tiles={3} chips={7} selects={3} buttons={2} cols={8} />;
}
