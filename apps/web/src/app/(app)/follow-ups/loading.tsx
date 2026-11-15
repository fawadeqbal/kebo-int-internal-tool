import { ListPageSkeleton } from "@/components/common/skeletons";

/** Follow-ups on its way. */
export default function Loading() {
  return <ListPageSkeleton tiles={0} chips={4} selects={3} buttons={1} rows={5} cols={5} />;
}
