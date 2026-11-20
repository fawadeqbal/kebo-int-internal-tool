import { Card, CardBody, CardHeader, Notice, capsClass } from "@kebo/ui";
import { api } from "@/lib/api";
import { CopyBlock, NewKeyButton } from "./form";
import type { WebsiteFormView } from "./types";

/** The snippet for a form on the company's website: it posts with the company's key. */
function snippet(v: WebsiteFormView) {
  return `<script>
/* RFQ Desk: send this website's inquiry form. Give the <form> id="rfq-form" and fields named
   fullName, email, phone, company, category, requirements. */
document.getElementById("rfq-form").addEventListener("submit", function (e) {
  e.preventDefault();
  var form = e.target, data = Object.fromEntries(new FormData(form));
  fetch("${v.endpoint}", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json", "X-Form-Key": "${v.key}" },
    body: JSON.stringify(Object.assign(data, { page: location.href }))
  }).then(function (r) { return r.json().then(function (d) { if (!r.ok || !d.ok) throw new Error(d.message || d.error || "Sorry, it could not be sent."); return d; }); })
    .then(function (d) { form.innerHTML = "<p>" + d.message + "</p>"; })
    .catch(function (err) { alert(err.message); });
});
</script>`;
}

/** Settings → Website form: the key and the ready-made snippet (Super Admin). */
export async function WebsiteFormCard() {
  const view = await api.get<WebsiteFormView>("/company/website-form").catch(() => null);
  return (
    <Card>
      <CardHeader
        title="Website form"
        description="Inquiries sent from a form on your own website arrive here as new inquiries. The form sends this key, which says they are for your company."
        actions={view ? <NewKeyButton /> : undefined}
      />
      <CardBody className="flex flex-col gap-5">
        {!view ? (
          <Notice tone="info">Only a Super Admin can see the website form&apos;s key.</Notice>
        ) : (
          <>
            {!view.allowed && (
              <Notice tone="todo">Your plan does not include the website form. Inquiries sent with this key are refused.</Notice>
            )}
            <div>
              <p className={capsClass}>Key</p>
              <CopyBlock text={view.key} label="Website form key" />
              <p className="mt-1 text-sm text-text-2">Keep it on your website only. Anyone with it can send inquiries to your company.</p>
            </div>
            <div>
              <p className={capsClass}>Snippet to paste before &lt;/body&gt;</p>
              <CopyBlock text={snippet(view)} label="Website form snippet" multiline />
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
