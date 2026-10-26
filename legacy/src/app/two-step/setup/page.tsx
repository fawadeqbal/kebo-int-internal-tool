import type { Metadata } from "next";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { getSessionUser } from "@/lib/auth/session";
import { otpauthUrl } from "@/lib/auth/totp";
import { getSettings } from "@/modules/settings/service";
import { pendingTwoStepSecret, twoStepStatus } from "@/modules/users/two-step";
import { confirmTwoStepAction, restartTwoStepSetupAction } from "@/modules/users/two-step-actions";
import { logoutAction } from "@/modules/users/auth-actions";
import { ConfirmTwoStepForm } from "@/modules/users/two-step-components";
import { AuthShell } from "@/app/login/auth-shell";

export const metadata: Metadata = { title: "Set up two-step sign-in" };
export const dynamic = "force-dynamic";

export default async function TwoStepSetupPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const status = await twoStepStatus(user.id);
  if (status.on) redirect("/account");
  const [secret, settings] = await Promise.all([pendingTwoStepSecret(user.id), getSettings()]);
  const url = otpauthUrl("Kebo RFQ Desk", user.email, secret);
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 360, errorCorrectionLevel: "M" });

  return (
    <AuthShell companyName={settings.companyName} wide>
      <h1 className="text-lg font-semibold text-text">Set up two-step sign-in</h1>
      <p className="mt-1 text-sm text-muted">
        {status.required ? "Your role needs it: " : ""}after your password, you&apos;ll also enter a code from your phone, so a stolen password alone can&apos;t open your account.
      </p>
      <ol className="mt-5 flex flex-col gap-5 text-sm text-text-2">
        <li>
          <p className="font-medium text-text">1. Install an authenticator app</p>
          <p>Google Authenticator, Microsoft Authenticator or any app that scans “TOTP” QR codes.</p>
        </li>
        <li>
          <p className="font-medium text-text">2. Scan this QR code with the app</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="QR code for your authenticator app" width={180} height={180} className="mt-2 rounded-lg border border-line bg-white p-1" />
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-muted hover:text-text">Can&apos;t scan? Enter this key instead</summary>
            <p className="mt-1 font-mono text-xs break-all text-text select-all">{secret.match(/.{1,4}/g)?.join(" ")}</p>
          </details>
        </li>
        <li className="flex flex-col gap-2">
          <p className="font-medium text-text">3. Enter the code it shows</p>
          <ConfirmTwoStepForm action={confirmTwoStepAction} />
        </li>
      </ol>
      <div className="mt-5 flex items-center justify-between border-t border-line pt-4 text-xs text-muted">
        <form action={restartTwoStepSetupAction}>
          <button type="submit" className="hover:text-text hover:underline">
            Show a new QR code
          </button>
        </form>
        <form action={logoutAction}>
          <button type="submit" className="hover:text-text hover:underline">
            Sign out
          </button>
        </form>
      </div>
    </AuthShell>
  );
}
