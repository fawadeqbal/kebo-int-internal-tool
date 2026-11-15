import { BoardSkeleton } from "@/components/common/skeletons";

/** The orders board on its way. */
export default function Loading() {
  return <BoardSkeleton columns={4} chips={2} />;
}
