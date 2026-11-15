import { RecordSkeleton } from "@/components/common/skeletons";

/** A purchase order on its way (the list has its own). */
export default function Loading() {
  return <RecordSkeleton tabs={0} />;
}
