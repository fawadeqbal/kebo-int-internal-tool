/** The script the web designer pastes into keboint.com to send the RFQ form here. */
export function websiteSnippet(appUrl: string) {
  const endpoint = `${appUrl.replace(/\/$/, "")}/api/public/inquiries`;
  return `<!-- Query system: send the RFQ form to ${appUrl}. Paste just before </body>. -->
<script>
(function () {
  var ENDPOINT = "${endpoint}";
  var form = document.querySelector("#contact form") || document.querySelector("form");
  if (!form) return;

  // Hidden anti-spam field: people never see it, bots fill it in.
  var trap = document.createElement("input");
  trap.type = "text"; trap.name = "website"; trap.tabIndex = -1; trap.autocomplete = "off";
  trap.style.cssText = "position:absolute;left:-9999px;opacity:0";
  form.appendChild(trap);

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var button = form.querySelector("[type=submit]");
    if (button) button.disabled = true;
    var data = new FormData(form);
    data.append("page", location.href);
    fetch(ENDPOINT, { method: "POST", body: data, headers: { Accept: "application/json" } })
      .then(function (response) { return response.json(); })
      .then(function (result) {
        alert(result.message);
        if (result.ok) form.reset();
      })
      .catch(function () { alert("Sorry, the form could not be sent. Please email or WhatsApp us."); })
      .finally(function () { if (button) button.disabled = false; });
  });
})();
</script>`;
}

export const FIELD_NAMES: [string, string][] = [
  ["Full Name", "fullName"],
  ["Business Email", "email"],
  ["Phone / WhatsApp", "phone"],
  ["Company Name", "company"],
  ["Sourcing Category", "category"],
  ["Detailed Requirements", "requirements"],
];
