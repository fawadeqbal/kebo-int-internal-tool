# Kebo — mobile app (Flutter)

The phone app for staff on the move, on the Kebo API (`apps/api`, every path under `/api`).
All calls go through one layer: `lib/core/repository.dart` (on `lib/core/api.dart`, which turns
the API's `{ error, code?, fieldErrors?, matches? }` into an `ApiException`).

| Area | What's in the app |
|---|---|
| Sign-in | Email + password, two-step code or recovery code, sign out (forgets this phone's push token), push registration (`POST /api/me/devices`); push links `/deals/<id>` and `/orders/<id>` open the right screen |
| Home | My to-do (next step of each order, late first), my open deals, new deals (managers), counts, money and team (managers) |
| Deals | Stage tabs (open, new, sourcing, quoted, won, lost, on hold), search, "mine / not assigned" (managers); deal page with items, customer and contact (call / WhatsApp / email), notes, files, history; take it / assign, start, on hold / resume, mark as lost with a reason, reopen (managers); new deal with a customer search and items |
| Quotation | Every revision (R1, R2…) with status, lines and totals; on the live one: mark as sent, customer accepted (makes the order) or rejected |
| Orders | Open / late / closed lists; order page with the 12-step checklist and the next step highlighted: mark done, skip, undo, with the rule shown when a step is refused (deposit first, inspection first, balance first, a note needed…); read-only payments, factory orders, invoices and shipments |
| Customers | Search, customer page with contacts, deals and orders, add a customer (contacts, country) with the duplicate warning and "save anyway" |
| More | Notifications, account (password, two-step sign-in), light / dark, sign out |

On the web only (the app says so where it matters): editing deals and customers, factory prices,
quotation prices and new revisions, recording payments, factory orders, invoices and shipments,
reports, users and settings.

## Build

```bash
flutter pub get
flutter build apk --release                     # Android: build/app/outputs/flutter-apk/app-release.apk
flutter build ipa --release                     # iPhone: on a Mac with Xcode
flutter build apk --release --dart-define=API_BASE=https://your-server   # another server
```

The server address can also be changed on the sign-in screen (the server name under "Sign in").

Release signing: `android/key.properties` and `android/kebo-rfq-release.jks` (both kept out of git).
Keep a safe copy of both — every future update must be signed with the same key.

## Tests

```bash
flutter analyze
flutter test                                                    # unit + widget tests (checklist from a real API response)
KEBO_API_URL=http://localhost:4000 flutter test test/api_integration_test.dart   # the repository against a running API (demo logins)
```
