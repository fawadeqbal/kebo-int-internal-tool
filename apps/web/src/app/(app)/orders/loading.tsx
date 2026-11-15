import { RecordSkeleton } from "@/components/common/skeletons";

/** An order on its way: its header, tabs and Overview (the list and the board have their own). */
export default function Loading() {
  return <RecordSkeleton tabs={10} />;
}
