import { ListPageSkeleton } from "@/components/common/skeletons";

/** The suppliers list on its way. */
export default function Loading() {
  return <ListPageSkeleton tiles={4} chips={4} selects={2} buttons={2} cols={9} />;
}
