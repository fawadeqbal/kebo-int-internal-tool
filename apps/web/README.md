# @kebo/web — conventions

The web app shows data and collects input. **Every rule lives in the API** (`apps/api`); the web never decides what is allowed, it only hides buttons the person cannot use.

## How a screen works

- **Reading**: server components call `api.get<T>(path, query)` from `@/lib/api`. It runs on the web server with the person's session token (httpOnly cookie `kebo_session`). Browsers never call the API directly. Use `load(() => api.get(...))` from `@/lib/session` when a 404/403 should show Next's not-found / forbidden page.
- **Who is signed in**: `await requireUser()` (`@/lib/session`) → `{ id, name, role, permissions }`. Hide controls with `can(me.role, "…")` from `@kebo/shared`.
- **Changing things**: a server action in an `actions.ts` next to the route (`"use server"`), wrapped in `attempt(form, () => api.post(...), "Success message")` from `@/lib/actions`, then `revalidatePath(...)`. API errors come back as `{ ok:false, message, errors (field errors), code, matches }` and are shown by the form.
- **Forms**: client components (`"use client"`) using `<ActionForm action={…}>` from `@/components/common/action-form`. Its children may be a function of the action state (`(s) => …`) to show `s.errors?.field` and keep `s.values` — **only inside client components** (a server component cannot pass a function to a client component). Bind ids with `action.bind(null, id)`.
- **Complex forms** (line items): keep the state in React, put `JSON.stringify(data)` into a hidden `<input name="payload">`; the action reads it with `formBody(form)`.
- **Types**: API response shapes in `src/lib/types.ts`; for a new area add `src/lib/types-<area>.ts` rather than editing shared files.
- **Look**: components from `@kebo/ui` (Card, CardHeader, CardBody, PageHeader, Field, Input, Select, Textarea, Table/THead/Th/Tr/Td, Badge, StageBadge, RevisionBadge, OrderStageBadge, EmptyState, LinkTabs, DetailList, Alert, ButtonLink, buttonClass…) and `@kebo/ui/client` (SubmitButton, ConfirmSubmit, PrintButton). Words from `@kebo/shared` labels (`INQUIRY_STAGE_LABEL`, `BALANCE_TERMS_LABEL`…). Money with `money(amount, currency)` and dates with `date()` from `@/lib/format`.
- **Writing**: plain business words, say what to do next, no jargon. Buttons say what they do ("Record the payment", not "Submit").

## Orders

An order is **Confirmed → In production → Shipped → Done**, moved by one button (`next.label` from `GET /orders/:id`) one stage at a time, or back with the small "Back to …" link. Nothing blocks a move: when something looks off the API answers 409 `{ code: "confirm", error }`; the form (`StageActions` in `orders/[id]/forms.tsx`, `ActionForm quietCodes={["confirm"]}`) shows the warning with **Go ahead anyway**, which resends the move with `confirm=true` and an optional note. The order page shows the stage bar and what the order needs now (`needs`), the money and payments (recording and removing payments: managers), the documents, details (`PATCH /orders/:id/details`), the history, and the deal's notes and files. The board (`/orders`) is four columns (Done: the recent ones), one stage per tab on phones; `?mine=1`, `?view=cancelled`.

## Printed documents and PDFs

- Print pages (server-rendered A4, outside the app shell, built from `src/components/print/*`; `?back=/path` sets where the toolbar's Back goes):
  - `/print/revisions/:id` — quotation (snapshots once sent; drafts carry a DRAFT watermark);
  - `/print/orders/:orderId/proforma | invoice | packing-list` — made from `GET /orders/:id/documents/:kind` whenever opened: the proforma asks for the deposit (with the bank details), the commercial invoice shows what was received and the balance due, the packing list has no prices;
  - `/print/report?from&to&staff` — the Reports page on paper (managers).
- `/pdf/:kind/:id` renders the same page with headless Chromium (`puppeteer-core`), on A4 with page numbers: `revisions/<revision id>`, `proforma|invoice|packing-list/<order id>`, `report/summary?from&to&staff` (any UUID works in place of `summary`). The API is asked first (403/404 before a browser starts). The session is the `kebo_session` cookie or an `Authorization: Bearer <token>` header (the phone app), used as the session cookie while rendering. Chromium is found by `src/app/pdf/chromium.ts`: `CHROME_PATH` first (set it in production, e.g. `/usr/bin/chromium`), then the usual system paths, then a Playwright download (`PLAYWRIGHT_BROWSERS_PATH`, `~/.cache/ms-playwright`). It renders from the server itself (`http://127.0.0.1:$PORT`), never from the request's address; `PDF_ORIGIN` overrides that. At most 3 PDFs render at once. Without Chromium the route answers 503 and people can still use Print → Save as PDF.

## Run it

```bash
# API (from the repo root, after pnpm build): DATABASE_URL=… AUTH_SECRET=… node apps/api/dist/main.js   (port 4000)
API_URL=http://localhost:4000/api pnpm --filter @kebo/web dev                                          # http://localhost:3000
```

Demo logins (after `pnpm db:seed --demo`): `manager@example.com` / `Manager@12345`, `bilal@example.com` / `Demo@12345` (staff), `admin@example.com` / `Admin@12345`.
