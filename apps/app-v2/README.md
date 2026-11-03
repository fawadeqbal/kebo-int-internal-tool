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
