import { ListPageSkeleton } from "@/components/common/skeletons";

/** Cash & bank on its way. */
export default function Loading() {
  return <ListPageSkeleton tiles={4} chips={0} filter={false} buttons={2} cols={6} />;
}
