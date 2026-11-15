import { ListPageSkeleton } from "@/components/common/skeletons";

/** Access on its way. */
export default function Loading() {
  return <ListPageSkeleton tiles={0} chips={0} filter={false} buttons={0} cols={5} />;
}
