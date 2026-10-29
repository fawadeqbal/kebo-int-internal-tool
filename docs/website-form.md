# Connecting the keboint.com RFQ form

Every time a visitor presses **Submit RFQ / Inquiry** on keboint.com, the inquiry is saved in the query system as a **Pending** query from the **Website**, the customer is added (or matched by email / phone if they wrote before), and the admin emails in **Settings → Email notifications** get an email straight away.

Nothing else on the website needs to change: the form keeps its look.

## Steps for the web designer

1. Make sure each form field has a `name` attribute. These names work (most common spellings are also accepted):

   | Field on the website       | `name`                        |
   | -------------------------- | ----------------------------- |
   | Full Name                  | `fullName` (or `name`)        |
   | Business Email             | `email`                       |
   | Phone / WhatsApp           | `phone`                       |
   | Company Name               | `company`                     |
   | Sourcing Category Required | `category`                    |
   | Detailed Requirements      | `requirements` (or `message`) |

2. Copy the ready-made script from **Settings → Website form** in the query system (a Super Admin sees it; it already contains the right server address and the company's **form key**) and paste it into the website just before `</body>`.

   The script sends the form in the background and shows the visitor a "Thank you" message. The visitor is not shown a reference number.

3. **Or, without JavaScript:** set the form tag to

   ```html
   <form action="https://YOUR-QUERY-SERVER/api/public/inquiries" method="POST">
     <input type="hidden" name="formKey" value="THE-KEY-FROM-SETTINGS" />
   </form>
   ```

## Security

- **The form key decides the company.** Every company has its own key (Settings → Website form); an inquiry without a valid key is refused. If a key gets out, make a new one there: the old one stops working at once.
- Without a key, only the websites listed in `PUBLIC_FORM_ORIGINS` (server `.env`, default keboint.com) are accepted, and only for the default company (`DEFAULT_COMPANY`): the Kebo site keeps working until its script sends the key (`docs/keboint-contact-form.js`).
- Hidden honeypot field to stop bots, a limit of 5 inquiries per 10 minutes per visitor and an hourly limit per company, and size limits on every field.
- The website can only _create_ inquiries — it can never read anything from the system, and the answer does not include the inquiry's number.
