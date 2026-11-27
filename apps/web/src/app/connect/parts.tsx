import { headers } from "next/headers";
import { CONNECT_SUB, connectTarget } from "@kebo/shared";
import { buttonClass, Field, Input, Scroll } from "@kebo/ui";

/** The address the record points to: connect.<BASE_DOMAIN> (or a stand-in where companies have no addresses of their own). */
export const target = () => (process.env.BASE_DOMAIN ? connectTarget(process.env.BASE_DOMAIN) : `${CONNECT_SUB}.your-rfq-desk-address`);

/** Where the check page is: /check at connect.<BASE_DOMAIN> (the proxy serves this folder there), else /connect/check. */
export async function checkPath() {
  const host = ((await headers()).get("x-forwarded-host") ?? (await headers()).get("host") ?? "").toLowerCase();
  return host.startsWith(`${CONNECT_SUB}.`) ? "/check" : "/connect/check";
}

/** "The address you are connecting" and Check: a plain GET form, so the check's link can be sent to someone. */
export function CheckForm({ action, value = "", label = "Check the record" }: { action: string; value?: string; label?: string }) {
  return (
    <form action={action} method="get" className="flex flex-wrap items-end gap-2">
      <Field label="The address you are connecting" htmlFor="connect-domain" className="min-w-0 flex-[1_1_16rem]">
        <Input
          id="connect-domain"
          name="domain"
          defaultValue={value}
          placeholder="staff.yourcompany.com"
          maxLength={253}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          required
          className="font-mono"
        />
      </Field>
      <button type="submit" className={buttonClass("primary", "md")}>
        {label}
      </button>
    </form>
  );
}

/** The one record, as a table to copy from. */
export function RecordTable({ name = "the first part, e.g. staff" }: { name?: string }) {
  return (
    <Scroll axis="x" size="lg" fade stack label="The record to add" className="rounded-lg border border-line">
      <table className="w-full min-w-[460px] text-left text-md">
        <thead className="bg-surface-2 text-xs text-text-2">
          <tr>
            <th className="px-3.5 py-2 font-semibold">Type</th>
            <th className="px-3.5 py-2 font-semibold">Name (or Host)</th>
            <th className="px-3.5 py-2 font-semibold">Value (or Points to)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="px-3.5 py-2.5 font-semibold">CNAME</td>
            <td className="px-3.5 py-2.5 font-mono">{name}</td>
            <td className="px-3.5 py-2.5 font-mono [overflow-wrap:anywhere]">{target()}</td>
          </tr>
        </tbody>
      </table>
    </Scroll>
  );
}
