/**
 * An email address that, when it must wrap, wraps before its "@" (never "…gmail.c / om", e2e 24 Nov). Put it in an
 * element with `break-words`, so only a part too long for its line on its own is cut.
 */
export function EmailText({ email }: { email: string }) {
  const at = email.indexOf("@");
  if (at <= 0) return <>{email}</>;
  return (
    <>
      {email.slice(0, at)}
      <wbr />
      {email.slice(at)}
    </>
  );
}
