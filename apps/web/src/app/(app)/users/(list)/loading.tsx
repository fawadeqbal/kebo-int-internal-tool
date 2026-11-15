import { ListPageSkeleton } from "@/components/common/skeletons";

/** The people list on its way. */
export default function Loading() {
  return <ListPageSkeleton tiles={0} chips={0} buttons={1} cols={6} />;
}
