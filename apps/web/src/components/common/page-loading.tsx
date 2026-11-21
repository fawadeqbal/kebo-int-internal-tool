"use client";

import { usePathname } from "next/navigation";
import { shapeOf } from "@/lib/page-shapes";
import { PageSkeleton } from "./skeletons";

/**
 * Every loading.tsx of the app is this (test/page-shapes.test.ts): the skeleton of the page being opened, from
 * its shape in lib/page-shapes.ts — a list's for a list, a record's for a record, under the same folder.
 */
export default function PageLoading() {
  return <PageSkeleton shape={shapeOf(usePathname())} />;
}

/** Inside a record (its top and tabs stay): only the body of the tab being opened. */
export function TabLoading() {
  return <PageSkeleton shape={shapeOf(usePathname())} tab />;
}
