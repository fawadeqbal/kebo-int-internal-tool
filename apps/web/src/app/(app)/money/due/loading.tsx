import { ListPageSkeleton } from "@/components/common/skeletons";

/** Money due on its way. */
export default function Loading() {
  return <ListPageSkeleton segment tiles={4} chips={3} selects={1} buttons={0} cols={8} />;
}
