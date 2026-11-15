import { ListPageSkeleton } from "@/components/common/skeletons";

/** Company costs on its way. */
export default function Loading() {
  return <ListPageSkeleton tiles={4} chips={0} selects={2} buttons={2} cols={6} />;
}
