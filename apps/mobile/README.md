# Kebo RFQ Desk — mobile app (Flutter)

The same system as the web, for Android (and iPhone): every role, every screen, the same rules.
It talks to the web server's JSON API (`/api/v1`, see `src/app/api/v1`), which calls the same
services, permissions and validation as the web screens — nothing is duplicated.

| Area | What's in the app |
|---|---|
| Sign-in | Email + password, two-step code or recovery code, two-step setup (QR / "open in authenticator"), sessions end with web sign-outs and password resets |
| Home | Dashboard cards by role: open / overdue work, this month, money (managers), team |
| Inquiries | List with status tabs, search and filters; create (existing or new customer, "Other" category, files); detail with status changes, assignment, call / WhatsApp / email, documents, files, notes, history; edit; remove |
| Customers | List (Staff: their own), detail with inquiries and money, add / edit / remove |
| Quotations | List and filters, create with live totals, edit drafts, mark sent / accepted / rejected / expired, new version, delete draft, PDF |
| Invoices | List and filters, issue from an accepted quotation, record payments, cancel, PDF |
| Packing lists | Create from an invoice, edit, remove, PDF |
| More | Notifications, reports (charts, PDF), users, settings, audit log, account (password, two-step), light / dark |

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
