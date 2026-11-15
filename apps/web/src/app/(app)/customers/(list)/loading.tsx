import { ListPageSkeleton } from "@/components/common/skeletons";

/** The customers list on its way. */
export default function Loading() {
  return <ListPageSkeleton tiles={4} chips={5} selects={3} buttons={2} cols={8} />;
}
