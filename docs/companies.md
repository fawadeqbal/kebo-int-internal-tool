# Companies (multi-company)

RFQ Desk runs many companies in one installation. Each company has its own people, roles, settings, numbering, inquiries, orders, money and files, and never sees another company's. A **platform admin** runs the companies: client inquiries (leads), demos, plans and payments.

## Who is who

| Who | Where | Does |
|---|---|---|
| Platform admin | `/platform` (own sign-in, two-step required) | Client inquiries, demos, companies, plans, payments. Can open any company and work in it; everything they do there is in the company's own history under their name ("Fawad Iqbal (platform admin)"), and in the platform log. |
| Tenant admin | inside one company | The company's Super Admin role: its people, roles, settings, money, security. Made with the company; gets an email link to set a password. |
| Managers, staff | inside one company | As before. |

## How companies are kept apart

**One database, one set of tables.** Every company table has a `company_id` column. Two locks keep companies apart:

1. **The API works in one company per request.** The company comes from the session (the token names it), so a request can never pick another company. Every query of company data goes through that company's own connection pool (`PrismaService.db`); outside a company there is no such connection, so company data cannot be read by mistake.
2. **The database checks it too (row-level security).** Company connections run as the restricted role `kebo_app` with `app.company_id` set when they connect. Policies on every company table let that role see and change only rows of its company; with no company set it sees nothing. New rows are tagged with the connection's company automatically (the column's default). A trigger on every link between company tables refuses a link to another company's row. The role has no access at all to the platform tables (companies, plans, leads, platform admins…).

The owner's connection (`PrismaService.platform`) is used only for the platform tables, and by the platform's export and delete, which name the company explicitly.

Other per-company things: settings and the settings cache, document numbers (each company starts at 0001), the Insights/home cache (`ReadCache`), new files (stored under `companies/<id>/…`), the worker (reminders run for each active company in turn).

**Tests**: `apps/api/test/companies.test.ts` signs in to one company and tries the other company's records on read and write routes (all refused), checks every company table at the database level, the platform tables' privacy, and cross-company links.

### Adding a table

A new company table needs, in its migration: the `company_id` column (copy the Prisma field from any model: `@default(dbgenerated("(current_setting('app.company_id'::text))::uuid"))` and the relation to `Company`), then

```sql
ALTER TABLE "x" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "x" USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON "x" TO kebo_app;
-- and for each link to another company table:
CREATE TRIGGER same_company_x_y_fkey BEFORE INSERT OR UPDATE OF y_id ON "x" FOR EACH ROW EXECUTE FUNCTION enforce_same_company('y', 'y_id');
```

The companies test fails if a table with `company_id` is not under row-level security. A platform table (not company data) gets none of this.

## Signing in

- People sign in at the usual page with email and password. The email decides the company; if the same email and password fit two companies, they choose.
- Sessions belong to one company. Sessions from before companies existed belong to the first company (Kebo), so nobody is signed out by the change.
- Platform admins sign in at `/platform/login` with password and an authenticator code.

## The platform admin's work

- **Client inquiries**: the public page `/request-a-demo` (and every self sign-up) makes a lead and emails the platform admins (`PLATFORM_EMAIL`, else every platform admin). Status: new → contacted → demo given → client / lost (with a reason); notes; follow-up date (shown on the overview when due).
- **Give a demo** (from a lead, or New company → demo): a company named `<name>-demo`, filled with sample data, for 3 days (or as chosen), with the person as tenant admin. Extend, end now, make it real (keep or clear the data), delete.
- **Companies**: name, short name (renaming keeps the old one working 30 days; a deleted company's name is held 90 days), plan, paid-until date, contact. Switch on, read-only or off by hand (the automatic rules then leave it alone, until "back to the automatic rules"). Export (a zip of every table as JSON and every file), delete (all data and files; type the short name to confirm), send the tenant admin a set-password link, open the company.
- **Plans**: price, people limit, files limit, and a checklist of features. Near a limit people see a warning; at the limit adding people or files stops. Nothing is deleted. No plan = no limits and every feature (Kebo).

  Every feature that is off is hidden in the apps **and refused by the API** (code `plan_feature`); `test/companies.test.ts` checks each one.

  | Feature | When off |
  |---|---|
  | Excel | no templates, uploads, exports or imports |
  | Mobile app | the phone app cannot sign in, and its open sessions stop |
  | Expenses | no expenses anywhere (orders, inquiries, customers, factories, Money) |
  | Insights | no Insights pages or targets |
  | Email reports | no daily summary or monthly email |
  | Cash book | no cash book, accounts or transfers |
  | Custom roles | only Super Admin, Manager and Staff (no new roles) |
  | Audit log | no audit log page (each record's own history stays) |
  | Website form | the company's website form is refused |

  Ready-made plans (made by a migration; change or remove them freely):

  | | Starter | Team | Business | Unlimited |
  |---|---|---|---|---|
  | Price / month | $49 | $99 | $199 | $399 |
  | People | 3 | 10 | 25 | no limit |
  | Files | 2 GB | 10 GB | 50 GB | no limit |
  | Features | Excel | + mobile app, expenses, Insights, email reports | everything | everything |
- **Payments**: recorded by hand; each sets the new paid-until date.

### Automatic rules (the worker, every hour)

| | When | Then |
|---|---|---|
| Demo / trial | 24 h before the end | email to its contact and the platform admins |
| | ended | read-only (email) |
| | 7 days after | switched off |
| | 37 days after | **deleted** (data and files) |
| Client | past paid-until | warning shown in the company |
| | 7 days past | read-only (email) |
| | 30 days past | switched off. **Never deleted.** |

Read-only: everyone can look, nothing can be changed. Off: nobody can sign in. A status set by hand is left alone by the rules.

### Self sign-up

`/sign-up` makes a 14-day trial company with the person as tenant admin, after they confirm their email. It is closed until `SIGN_UP_OPEN=true` and email (SMTP) is set up; otherwise the page offers "Request a demo". The bot check uses Cloudflare Turnstile when `TURNSTILE_SECRET_KEY` is set; public forms are rate-limited.

## Running it

| Setting | |
|---|---|
| `DEFAULT_COMPANY` | Short name of the company for requests that do not name one (the website form, old sessions). Default: the first company. |
| `PLATFORM_EMAIL` | Where new client inquiries and platform warnings are emailed (comma-separated). Default: every platform admin. |
| `SIGN_UP_OPEN` | `true` opens self sign-up (needs SMTP). |
| `COMPANY_POOL_SIZE` | Database connections per active company (default 4; idle companies' connections close after 10 minutes). |

The first platform admin (and more), on the server:

```bash
docker compose exec api node apps/api/dist/cli/platform-admin.js add you@example.com "Your Name"   # prints a link to set the password
docker compose exec api node apps/api/dist/cli/platform-admin.js list
docker compose exec api node apps/api/dist/cli/platform-admin.js off someone@example.com
```

Restoring a backup into a new database server: create the role first (`create role kebo_app nologin`), then restore as usual.

## Moving Kebo (the first deploy of this)

The migrations do it, in place: nothing moves.

1. `20261110090000_companies`: makes the platform tables and the role, adds `company_id` to every table with **Kebo's id for every existing row**, per-company keys and uniques, row-level security.
2. `20261110090100_utc_timestamps`: the time zone fix. The live database ran on Asia/Shanghai and the app's driver stored every time 8 hours early (round trips looked right, the database's own clock and raw reads did not). Every connection now runs in UTC (the database's default too), and the stored times are moved to the moment they meant. On a database that already ran in UTC nothing changes.
3. `20261110090200_same_company_links`: the cross-company link triggers.

Every deploy now copies the database first (`backups/pre-deploy-*.sql.gz` on the server, the last 10 kept; see `deploy/ci-deploy.sh`).

**Going back** (if something is wrong after the deploy): on the server, `git checkout` the previous commit and restore the pre-deploy copy:

```bash
cd /opt/kebo-desk
sudo docker compose stop api worker web
gunzip -c backups/pre-deploy-<…>.sql.gz | sudo docker compose exec -T db psql -q -U kebo -d kebo -c "drop schema public cascade; create schema public" -f -
sudo docker compose exec -T db psql -U kebo -d kebo -c "alter database kebo reset timezone"
git checkout <previous commit> && sudo docker compose up -d --build
```

(The pre-deploy copy is from before the migrations, so it matches the previous code; the time zone reset gives the old code the database's old time zone back.)

## Addresses per company

Off while `BASE_DOMAIN` is empty: then every company works at the one address, the email picks the company, and the platform area is `/platform`.

When on (`BASE_DOMAIN=rfq.fawadiqbal.dev`, `ROOT_COMPANY=kebo`):

| Address | Is |
|---|---|
| `acme.rfq.fawadiqbal.dev` | the company with the short name `acme`: its sign-in page shows its name, only its accounts can sign in there, and a session from another company is refused. |
| `admin.rfq.fawadiqbal.dev` | the platform area (`/platform` anywhere else is sent there). Opening a company takes the platform admin to the company's address with a one-time link (2 minutes). |
| `get.rfq.fawadiqbal.dev` | the marketing site (request a demo, sign up). |
| `rfq.fawadiqbal.dev` | sends every page on to `kebo.rfq.fawadiqbal.dev` (same path), except the marketing pages (to `get.`), set-password links from older emails, and the phone app's PDFs. `/api` is not a page: the phone app keeps working here. |
| a renamed company's old name | sends people on to the new one for 30 days, and stays held that long |
| an unknown name | "There is no company at this address" |

New companies get their address from the short name made when they are created. Short names follow the rules for addresses (3–30 characters, a–z 0–9 and dashes; reserved names such as `admin`, `www`, `api`, `get` refused). Emails link to the company's own address.

**Changing the address**: Settings → Company address (a Super Admin; the platform admin anytime from the company's page). The new name is checked while it is typed (free, taken, not allowed). Everyone signs in again at the new address; the old one sends people there for 30 days and is then free. A company can change it once every 30 days.

**Certificates**: Caddy makes one per address the first time it is opened (on-demand TLS), and only for addresses the API says are real (`/api/platform/public/domain-check`: the platform's own, the marketing site, existing companies and recently renamed ones). Let's Encrypt allows about 50 new certificates a week for the domain; past that, switch to one wildcard certificate (DNS challenge with the Namecheap API).

To switch on:

1. **DNS**: an A record `*.rfq` → `145.241.156.60` (the one for `rfq` stays).
2. **Caddy** (the shared server Caddy, `/opt/global-proxy/Caddyfile`): the `on_demand_tls { ask … }` global option at the very top, and the site block from `deploy/Caddyfile.companies` (with `__DOMAIN__` = `rfq.fawadiqbal.dev`); reload Caddy.
3. **`.env`** on the server: `BASE_DOMAIN=rfq.fawadiqbal.dev` and `ROOT_COMPANY=kebo`, then `sudo docker compose up -d`.

Switching off is the reverse of step 3: empty `BASE_DOMAIN`.

## The marketing site (get.rfq.fawadiqbal.dev)

The page people find RFQ Desk on: what it does, the plans, request a demo, ask a question, sign in. Without addresses per company it is at `/site`.

- **Edited in the platform panel, Website**: headline, features, steps, which plans show (prices and features come from the plans themselves), customer words (real ones only), questions, the closing band, contact details, and the title, description and picture for search and sharing. Saving keeps a **draft**; "Look at the draft" shows it as visitors would see it; **Publish** puts it live; the draft can be thrown away. Until the first publish the page shows ready-made words (`DEFAULT_SITE` in `packages/shared/src/site.ts`).
- **Leads**: the demo request, the question form and self sign-up all become client inquiries (Leads), with an email to the platform admins. Each keeps where it came from: the link's campaign tags (`utm_source`, `utm_medium`, `utm_campaign`), the site that sent them, the page and the button pressed; `channel` is one word to group by (the campaign source, else the referring site, else `direct`). Spam: a hidden field bots fill in, a limit per address (5 an hour) and for everyone, and Cloudflare Turnstile when `TURNSTILE_SECRET_KEY` is set.
- **Sign in**: asks for the work email and emails the sign-in address of each company that email has an account in (the answer is the same whether or not it has one, so nobody learns who uses RFQ Desk).
- **Numbers** (platform Overview, Website card): visitors, leads, how many reached a demo or trial and how many pay, this month against the last, the last 30 days, and per channel. Visits are counted by the web server without cookies: each visitor once a day, told apart by a one-way hash of the day, their address and browser, kept two days; crawlers and link previews are left out. Leads count in the month they came in, by how far they have got now.

Tag the links in ads and posts so their visitors and leads show per source, e.g. `https://get.rfq.fawadiqbal.dev/?utm_source=facebook&utm_campaign=november`.
