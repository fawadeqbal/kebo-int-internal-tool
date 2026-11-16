# Changelog

RFQ Desk phone app (`apps/phone`). Newest first. Each `## <version>` section is the text of that GitHub release.
Versions and builds follow `tool/src/version.dart`; tags are `phone-v<version>`.

## 3.0.0-alpha.8 — 2026-11-16

Step 8: partners, search and files.

- Customers and factories (More › Customers and factories): searchable lists; a customer's page with their contacts, deals and orders and Call / Chat / Mail; a factory's page with how to reach them (WeChat too), their offers, and bank details marked Internal.
- Search from any tab's header: one search over inquiries, orders, customers and factories, grouped.
- Files open in the app: PDFs page by page with pinch to zoom, photos with zoom. Other files open on the web to download.
- Web links to customers and factories open in the app.

## 3.0.0-alpha.7 — 2026-11-16

Step 7: Money.

- The Money tab: what customers still owe (late ones marked), what we owe each factory, and our accounts with their balances (for managers).
- "Received" on any order with money due: the amount (the due amount filled in), the day, how it came, which account, the reference, bank charges, a note and the slip. Take a photo of the slip or choose a file.
- People who record payments make the receipt at once; others send it to a manager, and the form says so.
- "Expense" from the Money tab or on an order: what it was, what for, the amount and currency, the day and the receipt.
- A success check when it is saved. Without signal the payment or expense waits on the phone, with its photo, and is sent in order when you are back.
- Files over the limit (25 MB, videos 100 MB) are refused with their size.

## 3.0.0-alpha.6 — 2026-11-16

Step 6: Orders.

- The Orders tab lists every order with where it stands in one word (Confirmed, In production, Shipped, Arrived, Delivered, Done), what it needs now and what is still due. Late ones come first. Chips for Open, Late, each stage, Done and Cancelled show their counts; search and "Mine" narrow it down.
- An order opens on its record header: total, received and due, its progress, and what it needs next (in red when late).
- "Where it stands": payment, factory, production, shipping, documents and delivery, each with its word, its facts and what is missing.
- Money (total, advance, received, still due, bank charges, with a received bar), the lines, the papers (final, draft or needed) and every file of the order.
- "Delivered in full" and "SAT passed" are confirmed from the phone with their day. Without signal they wait on the phone and are sent when you are back.
- Web links to orders open in the app.

## 3.0.0-alpha.5 — 2026-11-16

Step 5: Sales.

- The Sales tab lists every inquiry with who, what, where it stands, items, offers in and the quoted total. Chips for Open, New, Getting prices, Quoted, Overdue, On hold, Won and Lost show their counts; search and "Mine" narrow it down; more load as you scroll.
- An inquiry opens on its record header: stage, overdue / on hold / urgent, items, needed by, its progress from New to Won, and Call, Chat (WhatsApp) and Mail for the contact.
- Then the details (empty ones say "Not set"), what they need, the items, the quotation, the follow-ups and the notes. Add a note right there.
- The quotation has two views of one document: Customer (exactly what they receive) and Internal (adds the factory, cost, profit and margin, each marked Internal, with a warning when the margin is low or lines have no cost).
- Put on hold or take off hold, mark as lost (with the reason, so reports can learn), and reopen.
- New inquiry in three short steps (who asked, what they need, their items) and a review, with a success check when it is saved.

## 3.0.0-alpha.4 — 2026-11-16

Step 4: Home and the tabs.

- Home opens on the brand band with your greeting, the date and how many things need you.
- "Needs you now": overdue money, missing papers and dates, most urgent first, each opening where it points. "All" lists every one.
- "Today": your follow-ups due today or late, each with Done. Marking the last follow-up of an open inquiry done asks for the next one, so no inquiry is left with nothing planned.
- "This month": won (and how far to target), received, still to receive and open orders.
- The bell shows the unread count on every tab and opens Alerts: grouped by day, unread ones stand out, "Unread" filter, mark all as read.
- The five tabs: Home, Sales, Orders, Money and More. More has your account, light / dark / phone appearance, what waits on this phone, and sign out. Sales, Orders and Money fill in over the next steps.
- When there's no signal, every header says "Offline" with the time of the figures, and Home says what waits to send.

## 3.0.0-alpha.3 — 2026-11-16

Step 3: the core. The app now signs in to your RFQ Desk server.

- Sign in with your work email and password. If your email is in more than one company you choose which; if two-step sign-in is on you enter the code (or a recovery code).
- You stay signed in between launches; the token lives in the phone's secure keystore.
- Works without signal: pages you opened are kept and shown with their time ("Offline · 9:41"), and what you save waits on the phone and is sent when you are back. Money saves are sent exactly once.
- The server can be changed on the sign-in screen, for companies that run their own.
- Signing out removes everything of yours from the phone, and asks first when something is still waiting to send.

## 3.0.0-alpha.2 — 2026-11-16

Step 2: every Kestrel component the screens need. Still opens the design gallery; tap "Open screens and patterns" to see them with real RFQ Desk content.

- Forms: text fields whose label always stays visible, pickers, search, checkboxes, radios, switches, the Internal | Customer switch, and filter chips.
- Long forms are split into steps with a review page before anything is saved; going back never loses what you typed.
- Proof and attachments: take a photo or choose a file, see uploads in place, and a failed file tells you why and offers Try again.
- Records: the record header (type and number, status, key figures, progress, who changed it last) and read-only details that say "Not set" for empty fields and lock internal ones.
- Tab screens: the app header with company, sync status, search, the notification bell with its count and your account; the brand greeting band on Home.
- Navigation: top bar, tab bar with badges, and the floating add button.
- Feedback: bottom sheets that ask before throwing away your changes, confirm dialogs that name what they do, and toasts with Undo.

## 3.0.0-alpha.1 — 2026-11-16

First build of the new phone app (step 1: foundations). Not for daily use yet: it opens the design gallery.

- The Kestrel design system in the app: colours for light and dark, the type scale, spacing, corners, sizes and elevation, all generated from the design system's tokens.
- The feel: every tap springs softly and gives a light haptic; a success check that draws itself; a small celebration for the big wins. All of it follows the phone's "reduce motion" setting.
- First components: buttons, icon buttons with an unread count, badges (with the Internal tag), avatars, banners, loading skeletons and the 48 Kestrel icons.
- Versions, Android builds and GitHub releases: one version in pubspec.yaml, the Android build number worked out from it, and signed APKs attached to each release.
