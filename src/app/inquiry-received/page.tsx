import type { Metadata } from "next";
import { getSettings } from "@/modules/settings/service";

export const metadata: Metadata = { title: "Inquiry received" };

/** Public thank-you page used when the website form posts without JavaScript. */
export default async function InquiryReceived({ searchParams }: { searchParams: Promise<{ ref?: string; error?: string; back?: string }> }) {
  const { ref, error, back } = await searchParams;
  const settings = await getSettings();
  const backUrl = back && /^https?:\/\/[^/]+$/.test(back) ? back : null;
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-8 text-center shadow-card">
        {error ? (
          <>
            <h1 className="text-lg font-semibold text-text">Your RFQ was not sent</h1>
            <p className="mt-2 text-sm text-muted">{error.slice(0, 200)}</p>
          </>
        ) : (
          <>
            <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-ok-soft text-ok" aria-hidden>
              <svg viewBox="0 0 16 16" className="size-5" fill="none">
                <path d="m4 8.5 2.5 2.5L12 5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h1 className="text-lg font-semibold text-text">Thank you, we have your RFQ</h1>
            {ref && (
              <p className="mt-2 text-sm text-muted">
                Your reference number is <span className="font-mono font-semibold text-text">{ref.slice(0, 30)}</span>
              </p>
            )}
            <p className="mt-2 text-sm text-muted">Our sourcing team will reply within one working day.</p>
          </>
        )}
        <p className="mt-6 text-sm text-muted">
          {settings.companyName}
          {settings.companyEmail && ` · ${settings.companyEmail}`}
          {settings.companyPhone && ` · ${settings.companyPhone}`}
        </p>
        {backUrl && (
          <a href={backUrl} className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
            ← Back to the website
          </a>
        )}
      </div>
    </main>
  );
}
