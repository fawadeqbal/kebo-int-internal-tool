import { requireUser } from "@/lib/auth/session";

export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return <div className="min-h-screen bg-stone-200 py-8 print:bg-white print:py-0">{children}</div>;
}
