import { PageSkeleton } from "@/components/common/skeletons";
import { shapeOf } from "@/lib/page-shapes";

export const metadata = { title: "Loading" };

/**
 * A page's skeleton, held still (?path=/customers, &tab=1 for a record's tab): what loading.tsx shows for that
 * address. The browser test skeletons.spec.ts puts it beside the page itself and checks they have the same parts.
 */
export default async function LoadingPreview({ searchParams }: { searchParams: Promise<{ path?: string; tab?: string }> }) {
  const { path = "/dashboard", tab } = await searchParams;
  // data-preview: the test waits for it, so it never reads the app's own loading screen in its place.
  return (
    <div data-preview="" className="contents">
      <PageSkeleton shape={shapeOf(path)} tab={tab === "1"} />
    </div>
  );
}
