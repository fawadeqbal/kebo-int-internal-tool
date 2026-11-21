import { formValues } from "@/lib/actions";

/** The sending email as the form typed it (company or platform). A password or key left empty keeps the stored one. */
export function mailBody(form: FormData) {
  const v = formValues(form);
  return {
    provider: v.provider,
    fromName: v.fromName ?? "",
    fromEmail: v.fromEmail ?? "",
    ...(v.provider === "smtp" ? { host: v.host ?? "", port: v.port ?? "" } : {}),
    ...(v.provider !== "resend" && v.username?.trim() ? { username: v.username } : {}),
    ...(v.secret ? { secret: v.secret } : {}),
  };
}
