import { ListPageSkeleton } from "@/components/common/skeletons";

/** Alerts on its way. */
export default function Loading() {
  return <ListPageSkeleton tiles={0} chips={7} filter={false} buttons={1} cols={4} />;
}
