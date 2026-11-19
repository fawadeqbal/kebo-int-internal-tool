import { TabSkeleton } from "@/components/common/skeletons";

/** An inquiry's tab on its way: only its boxes show their outline; the inquiry's top, tabs and panel stay. */
export default function Loading() {
  return <TabSkeleton side={false} />;
}
