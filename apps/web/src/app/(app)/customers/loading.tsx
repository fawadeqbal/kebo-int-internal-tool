import { RecordSkeleton } from "@/components/common/skeletons";

/** A customer on its way: header, tabs, figures and Overview (the list has its own). */
export default function Loading() {
  return <RecordSkeleton tabs={6} tiles={4} chips />;
}
