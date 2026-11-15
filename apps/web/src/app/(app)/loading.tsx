import { ListPageSkeleton } from "@/components/common/skeletons";

/** A page on its way (pages without a skeleton of their own): its header and a table. */
export default function Loading() {
  return <ListPageSkeleton tiles={0} chips={0} filter={false} />;
}
