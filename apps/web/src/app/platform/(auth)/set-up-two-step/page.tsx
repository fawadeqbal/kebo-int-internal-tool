import Link from "next/link";
import { redirect } from "next/navigation";
import { ApiError, platformApi } from "@/lib/api";
import type { PlatformAdmin } from "@/lib/types-platform";
import { AuthShell } from "@/app/login/auth-shell";
import { TwoStepPanel } from "@/app/(app)/account/forms";
import { platformConfirmTwoStepAction, platformLogoutAction, platformNoopAction, platformStartTwoStepAction } from "../../actions";

export const metadata = { title: "Set up two-step sign-in" };

/** Platform admins reach every company, so two-step sign-in is required before anything else opens. */
export default async function PlatformSetUpTwoStepPage() {
  let me: PlatformAdmin;
  try {
    me = await platformApi.get<PlatformAdmin>("/auth/me");
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect("/platform/login");
    throw e;
  }
  return (
    <AuthShell wide subtitle="Platform admin">
      <h1 className="text-lg font-semibold">Set up two-step sign-in</h1>
      <p className="mt-1 mb-5 text-sm text-text-2">
        Hello {me.name}. A platform admin can open every company, so a code from your phone is needed as well as your password.
      </p>
      <TwoStepPanel
        status={{ on: me.twoStepOn, since: null, recoveryCodesLeft: 10, required: true, roleName: "Platform admin" }}
        sinceText={null}
        start={platformStartTwoStepAction}
        confirm={platformConfirmTwoStepAction}
        newCodes={platformNoopAction}
        turnOff={platformNoopAction}
        doneHref="/platform"
      />
      {me.twoStepOn ? (
        <div className="mt-6 border-t border-line pt-4 text-center">
          <Link href="/platform" className="text-sm font-medium text-primary hover:underline">
            Go to the platform
          </Link>
        </div>
      ) : (
        <form action={platformLogoutAction} className="mt-6 border-t border-line pt-4 text-center">
          <button type="submit" className="text-xs font-medium text-muted hover:text-text">
            Not now: sign out
          </button>
        </form>
      )}
    </AuthShell>
  );
}
