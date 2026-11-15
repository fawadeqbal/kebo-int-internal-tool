import { RecordSkeleton } from "@/components/common/skeletons";

/** A payment on its way (the list has its own). */
export default function Loading() {
  return <RecordSkeleton tabs={0} side />;
}
