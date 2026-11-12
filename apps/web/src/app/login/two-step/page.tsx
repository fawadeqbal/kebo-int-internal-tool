import { Suspense } from "react";
import { ShieldCheck } from "lucide-react";
import { Toast } from "@kebo/ui/client";
import { TwoStepForm } from "../forms";

export const metadata = { title: "Two-step sign-in" };

/** Board "Two-step sign-in": one card in the middle of the page, the shield, six boxes for the code. */
export default async function TwoStepPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4 py-10">
      <div className="flex w-full max-w-[440px] flex-col gap-4 rounded-[18px] border border-line bg-surface p-6 text-center sm:p-8">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-primary-soft text-primary" aria-hidden>
          <ShieldCheck className="size-[26px]" />
        </span>
        <h1 className="text-2xl font-bold text-text">Two-step sign-in</h1>
        <p className="-mt-2 text-muted">Enter the 6-digit code from your authenticator app.</p>
        <TwoStepForm next={next} />
      </div>
      <Suspense>
        <Toast />
      </Suspense>
    </main>
  );
}
