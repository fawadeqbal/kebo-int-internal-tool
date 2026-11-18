import { RecordSkeleton } from "@/components/common/skeletons";

/** A supplier on its way: header, tabs, figures and Overview (the list has its own). */
export default function Loading() {
  return <RecordSkeleton tabs={5} tiles={4} />;
}
