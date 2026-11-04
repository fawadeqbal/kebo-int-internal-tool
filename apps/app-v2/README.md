# RFQ Desk phone app (v2)

The phone app rebuilt on the design system (canvas page 31). It replaces `apps/mobile` when it is complete.

## How it is built

Most of the code is **generated from a short description** of the app, so screens look and work the same everywhere and nothing is written twice.

```
spec/                 what the app is: edit these
  app.yaml            tabs and lists of values (with their status colours)
  entities/*.yaml     the records the API returns: fields, types, labels, rules, permissions
  screens/*.yaml      each screen: list, record or form sheet, and what it shows
gen/                  Python that turns the spec into Dart
lib/generated/        written by gen: models, API calls, screens, routes   (never edit)
lib/ds/tokens.g.dart  colours read from the web (packages/ui/src/styles/theme.css)
test/generated/       written by gen: a test per record and per screen    (never edit)
lib/ds/               the design system, written by hand once: theme, rows, cards, badges, fields, the three frames
lib/core/             API client, session, sign-in state
lib/custom/           screens with real logic: sign-in, More, the tab shell
```

Every screen is one of three frames (`lib/ds/frames.dart`, `lib/ds/form_sheet.dart`):

- **list**: search, rows that open on tap, pages as you scroll, pull to refresh, one "New" button
- **record**: title, one primary button, ⋯ for the rest, sections in a fixed order with chips that jump to each
- **sheet**: every add and edit, labelled fields, one Save, "Discard changes?" when closing

The generator refuses a spec with a missing field, a screen pointing nowhere, more than one primary button,
or a form editing a read-only field.

## Files and papers

Every file opens inside the app (`lib/ds/file_viewer.dart`, `lib/core/files.dart`):

- PDFs with pages, zoom and "page 2 of 5"; photos with zoom; videos; text. Other kinds (Word, Excel, zip, HEIC) open in another app.
- Share (WhatsApp, email, WeChat…), Save to phone, Open in another app, Load again: on every file.
- A download bar while it loads; a copy is kept on the phone, so a file seen once opens without a connection (with a note saying so).
- Papers of an order (`lib/custom/order_papers.dart`): every paper the system makes, the accepted quotation and
  uploaded papers. The quotation and the proforma also have their internal copy (costs, margin, payments), marked
  "for us only". Sharing or saving a paper or file is noted in the order's history, like on the web.
- Files of an order (`lib/custom/order_files.dart`): grouped like the web; Add takes a photo, picks a photo or video, or a file.

A record screen puts a hand-written section in its place with `custom: WidgetName` in the spec.

## Share into the app

From WhatsApp, email or the Files app, **Share → RFQ Desk** with a message and/or files (photos, PDFs, Word, Excel,
drawings: the kinds the server takes) opens a new inquiry (`lib/custom/new_inquiry.dart`, route `/inquiries/new`):

- The message goes in "Their message" and its first line becomes the title. An email's subject and body, or a
  photo's caption, come along (`MainActivity.kt`, channel `rfqdesk/share`).
- The files are listed on the form (remove, or add more) and sent to the inquiry one by one right after it is saved;
  what fails is said in the toast, to add again on the inquiry. Kinds the server refuses (HEIC, video) are listed as not attached.
- Signed out: sign-in comes first, then the share continues (`ShareInbox` in `lib/core/share_in.dart` keeps it).
- The link `rfqdesk://inquiries/new?text=…` does the same with the text.

The share sheet comes through `receive_sharing_intent`; tests use a fake `ShareSource` (`test/custom/share_in_test.dart`).

## Android build

```sh
flutter build apk --release --dart-define=KEBO_SERVER=https://rfq.fawadiqbal.dev
# → build/app/outputs/flutter-apk/app-release.apk  (package dev.fawadiqbal.rfqdesk, label "RFQ Desk")
```

- Version: `version:` in pubspec.yaml (name+code), or `--build-name` / `--build-number`.
- Icon: `python3 -m gen.icon` draws "RQ" on the brand colour (primarySolid in `lib/ds/tokens.g.dart`) at every density, needs Pillow.
- Permissions: INTERNET only. The camera opens through the system camera app, which needs none.
- **Signing.** The release build uses `android/key.properties` when it exists, otherwise the debug key, so a local
  test APK installs. `key.properties` and `*.jks` are never committed (.gitignore). `key.properties` holds:
  ```
  storeFile=../release.jks      # relative to android/
  storePassword=…
  keyAlias=rfqdesk
  keyPassword=…
  ```
  For the GitHub release (later, with Fawad): the keystore goes into the repository secrets (base64), the release
  workflow writes `release.jks` and `key.properties` from them before `flutter build apk --release`, then attaches the
  APK to the release. Keep a copy of the keystore safe: an app signed with another key cannot update this one, and
  people would have to uninstall it first. A debug-signed test APK has the same problem: uninstall it before
  installing the first release-signed one.

## Commands (in apps/app-v2)

```sh
pip install -r gen/requirements.txt
python3 -m gen            # write the generated code after changing spec/
python3 -m gen --check    # CI: fails when the generated code is out of date
flutter analyze && flutter test
python3 -m gen.fonts      # only when the web's Inter font changes
flutter run --dart-define=KEBO_SERVER=https://rfq.example.com
```

## Adding a screen

1. Describe the record in `spec/entities/` (if it is new) and the screen in `spec/screens/`.
2. `python3 -m gen`; the screen, its route and its tests appear.
3. Only behaviour no frame has goes in `lib/custom/`.
