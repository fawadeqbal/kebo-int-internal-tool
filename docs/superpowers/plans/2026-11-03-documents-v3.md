# Documents v3 — one place for papers, the bank and files; tools on every file and paper

Approved 3 Nov 2026 from canvas page 22 "Documents v3" (https://claude.ai/artifact/9bXSortRgmEAtfG2WQSCuu).
Boards: DocsV3Page, DocsV3AllPapers, DocsV3OnStep, DocsV3Rules, DocsV3Phone, DocsV3Tools, DocsV3Many,
DocsV3PhoneTools (/home/claude/canvas/project/*.dc.html, previews /home/claude/preview/DocsV3*.png).
Today's page: /home/claude/shots/v4/documents-1440.png (every paper shown 3–4 times, bank steps twice,
files scattered).

## Where each thing lives (once)
| Thing | Lives in | Shown elsewhere as | Removed |
|---|---|---|---|
| A paper (made, uploaded, kept elsewhere) | Documents › Papers | a chip on its step (✓ / missing) linking to it; the order bar's count | checklist rows per paper (`doc:*` auto items no longer rendered as rows), Paper set card, "Made from the order" list, Papers side cards on steps |
| A bank step | Documents › Through the banks | the current one on Home/Overview | `bank:*` checklist rows, the second Bank steps list |
| A file | Documents › Files of this order | a chip on the row/paper/payment it was added with; the step's "Files" side card | separate URS card on the order, "No files on this step" when files exist |
The step's count in the bar = papers + bank steps (keep the same numbers the `doc:*`/`bank:*` auto
items give today — they stay in the data/API, just not rendered as checklist rows on Documents).
Documents shows a checklist card only if the company list has own items for this step.

## Documents & bank page
Header: "n of m papers for the bank ready · <missing> · bank: <current step>" + Upload files · Make a paper.
1. **Papers** table: mark, paper, number · date, From (Made by the app / Uploaded / Kept elsewhere /
   Missing / Can be made), file (version / file name / where kept), one action (View / Print, Make,
   Upload, View, Change) + ⋯ paper menu. Tabs: For the bank (required set) · All papers (every paper of
   the order grouped by step: payment, factory & production, shipping & bank, delivery) · Missing.
   Upload/Kept elsewhere open inline in the row (number + date prefilled from the shipment/order + file).
   Footer: "n of m ready" + what's still needed + Download the set + Make a paper.
2. **Through the banks**: horizontal tracker of the route's bank steps (bankStepsFor), only the current
   step has its button (Done today / courier no. / Record it = money reached us); done steps show date.
   Phone: vertical list, current + next, "+ n more".
3. **Files of this order · n**: one list of every file of the order (deal attachments incl. URS/drawings,
   order documents' files, checklist item attachments, payment/factory payment/expense files, paper
   final PDFs if stored). Grouped Customer · Factory · Shipping · Bank · Money (seg filter with counts),
   search, Download all (zip), Upload. Each row: icon, name · size, "attached to" chip ("Inquiry · URS",
   "Paper · Insurance", "Checklist · Loaded", "Payment · deposit 06 Nov"), step, who · date, tools.
Side: Changes in this step.

## Tools — the same everywhere (one component)
- `FileActions`-like **file chip / row**: 👁 View · ⤓ Download · ⋯ (Share…, Rename, Say what it is,
  Attach to… (a paper / a checklist item / a step), Replace with a newer one (keeps the old as a
  version), Delete). Used on checklist rows, paper rows, Files list, payments, expenses, inquiry files.
- **Paper actions**: View / Print · Download PDF (unchanged buttons) · ⋯ (Share…, Make again,
  Attach the signed scan, Versions, Kept elsewhere instead, Delete the draft).
- **View opens here**: side panel previewer for PDF/images (‹ › through files of the same set),
  Download/Share/Replace/Delete, what it is, attached to, added by/when, size. Others download.
- **Many at once**: checkboxes in the Files list → bar: Download as zip · Share… · Attach to… · Delete.
  Papers: Download the set as one PDF (merge the PDFs server-side — use the existing PDF route per paper
  and merge with pdf-lib, or zip if merging is not feasible) / as zip.
- **Share…**: phone → Web Share API with the files (navigator.share({files})); desktop → download zip
  + copy the prepared message (order no., papers, vessel/ETA). Nothing is sent by the app; record a
  `file.share` history row.
- **Drop anywhere**: dropping files on an order page shows the overlay; dropped on a checklist row or a
  paper → attached there; elsewhere → that step's files.
- Phone: tapping a file opens a bottom sheet with the same tools.
Permissions: view/download for anyone who can see the order; rename/attach/replace/delete with the
permission of the thing it's attached to (documents.manage for papers, orders.update for checklist,
payments.record for payment files, expenses.manage for receipts); delete asks to confirm and is audited.

## Data/API (only what's needed)
Files today live in several places (Attachment on the inquiry, order_documents.attachment_id, checklist
attachment_id, payment/factory payment/expense file columns, order_papers). Build an **order files read
model** (`GET /orders/:id/files`) that unions them with: id, source kind, name, size, type, attached-to
label + link, step, group (customer/factory/shipping/bank/money), added by/at, can-edit flags. Add
rename / tag ("what it is") / attach / replace / delete endpoints where missing, each permission-checked
per source and audited (`file.*` actions mapped to steps in STEP_OF_ACTION). Version on replace: keep
the previous file (attachments table: `replaced_by`/`version` columns if needed — migration after
20261128000000_light_steps with RLS unchanged/extended). Zip/merge endpoints stream; respect RLS.

## Other steps
Replace the Papers side card on step pages with a one-line "Papers of this step" chip strip (✓ / •
missing) linking to Documents › Papers?tab=…; the step's "Files" side card lists files of that step
using the shared file row. Checklist rows show their files as chips with the tools.

## Non-negotiable
LineTable unchanged; PDF View / Print + Download PDF buttons unchanged; mobile 390px; element-level
permissions; RLS (new tables/columns follow the pattern); no AI/OCR; existing endpoints stay backward
compatible (mobile app).

## Done when
typecheck/lint/test/build green; API tests (files read model incl. RLS + per-source permissions,
rename/attach/replace/delete, zip/set download, share audit); screenshots (Documents page, All papers,
previewer, bulk bar, share dialog, a step page with the chip strip and Files card, phone file sheet)
at 1440/390 in /home/claude/shots/docs-v3/; PR to main; CI green. Do not merge.
