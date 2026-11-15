import { BoardSkeleton } from "@/components/common/skeletons";

/** Shipments on its way. */
export default function Loading() {
  return <BoardSkeleton columns={4} chips={2} />;
}
