import type { Metadata } from "next";
import { getSettings } from "@/modules/settings/service";

export const metadata: Metadata = { title: "Inquiry received" };

/** Public thank-you page used when the website form posts without JavaScript. */
export default async function InquiryReceived({ searchParams }: { searchParams: Promise<{ ref?: string; error?: string; back?: string }> }) {
  const { ref, error, back } = await searchParams;
  const settings = await getSettings();
  const backUrl = back && /^https?:\/\/[^/]+$/.test(back) ? back : null;
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-8 text-center shadow-sm">
        {error ? (
          <>
            <h1 className="text-xl font-semibold">We couldn&apos;t send your inquiry</h1>
            <p className="mt-2 text-sm text-muted">{error.slice(0, 200)}</p>
          </>
        ) : (
          <>
            <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-emerald-50 text-emerald-700" aria-hidden>
              ✓
            </div>
            <h1 className="text-xl font-semibold">Thank you — inquiry received</h1>
            {ref && (
              <p className="mt-2 text-sm text-muted">
                Your reference number is <span className="font-mono font-semibold text-ink">{ref.slice(0, 30)}</span>
              </p>
            )}
            <p className="mt-2 text-sm text-muted">Our team will contact you shortly.</p>
          </>
        )}
        <p className="mt-6 text-sm text-muted">
          {settings.companyName}
          {settings.companyEmail && ` · ${settings.companyEmail}`}
          {settings.companyPhone && ` · ${settings.companyPhone}`}
        </p>
        {backUrl && (
          <a href={backUrl} className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline">
            ← Back to the website
          </a>
        )}
      </div>
    </main>
  );
}
