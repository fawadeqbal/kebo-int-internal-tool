import { FormPageSkeleton } from "@/components/common/skeletons";

/** Recording money, on its way. */
export default function Loading() {
  return <FormPageSkeleton sections={1} fields={6} />;
}
