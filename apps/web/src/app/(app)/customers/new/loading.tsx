import { FormPageSkeleton } from "@/components/common/skeletons";

/** The new customer form on its way. */
export default function Loading() {
  return <FormPageSkeleton sections={1} fields={6} />;
}
