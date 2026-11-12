import { ListPageSkeleton } from "@/components/common/skeletons";

/** The list on its way (board "Loading"). */
export default function Loading() {
  return <ListPageSkeleton tiles={4} chips={0} />;
}
