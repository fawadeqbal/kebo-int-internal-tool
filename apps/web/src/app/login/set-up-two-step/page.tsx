import Link from "next/link";
import { redirect } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import type { Me } from "@/lib/session";
import type { TwoStepStatus } from "@/lib/types-people";
import { confirmTwoStepAction, newRecoveryCodesAction, startTwoStepAction, turnOffTwoStepAction } from "@/app/(app)/account/actions";
import { TwoStepPanel } from "@/app/(app)/account/forms";
import { logoutAction } from "../actions";
import { AuthShell } from "../auth-shell";

export const metadata = { title: "Set up two-step sign-in" };

/**
 * Where people land when their role needs two-step sign-in and they have not
 * set it up: nothing else opens until they have (the API refuses everything else).
 */
export default async function SetUpTwoStepPage() {
  let me: Me;
  try {
    me = await api.get<Me>("/auth/me");
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect("/login");
    throw e;
  }
  const status = await api.get<TwoStepStatus>("/me/two-step");
  // Once it is on, the page stays (the recovery codes are still on screen) with a way on; otherwise there is nothing to do here.
  if (!me.twoStepSetupRequired && !status.on) redirect("/dashboard");
  return (
    <AuthShell wide>
      <h1 className="text-lg font-semibold">Set up two-step sign-in</h1>
      <p className="mt-1 mb-5 text-sm text-text-2">
        Hello {me.name}. Your role ({me.roleName}) needs a code from your phone as well as your password. Set it up now to carry on; it takes two minutes.
      </p>
      <TwoStepPanel
        status={status}
        sinceText={null}
        start={startTwoStepAction}
        confirm={confirmTwoStepAction}
        newCodes={newRecoveryCodesAction}
        turnOff={turnOffTwoStepAction}
        doneHref="/dashboard"
      />
      {status.on ? (
        <div className="mt-6 border-t border-line pt-4 text-center">
          <Link href="/dashboard" className="text-sm font-medium text-primary hover:underline">
            Go to the app
          </Link>
        </div>
      ) : (
        <form action={logoutAction} className="mt-6 border-t border-line pt-4 text-center">
          <button type="submit" className="text-xs font-medium text-muted hover:text-text">
            Not now: sign out
          </button>
        </form>
      )}
    </AuthShell>
  );
}
