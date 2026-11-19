import { TabSkeleton } from "@/components/common/skeletons";

/** An order's tab on its way: only its boxes show their outline; the order's top, tabs and panel stay. */
export default function Loading() {
  return <TabSkeleton side={false} />;
}
