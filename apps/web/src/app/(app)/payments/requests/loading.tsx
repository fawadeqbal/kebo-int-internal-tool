import { RecordSkeleton } from "@/components/common/skeletons";

/** A payment request on its way. */
export default function Loading() {
  return <RecordSkeleton tabs={0} />;
}
