import { ListPageSkeleton } from "@/components/common/skeletons";

/** The inquiries list on its way. */
export default function Loading() {
  return <ListPageSkeleton tiles={4} chips={8} selects={4} buttons={2} cols={7} />;
}
