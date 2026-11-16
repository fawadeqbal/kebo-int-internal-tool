# RFQ Desk — phone app (v3)

The new phone app for RFQ Desk, built from the start on **Kestrel**, the mobile design system
(https://claude.ai/artifact/MiX4EaJ9nMFzhgqVfr8MMp) and its approved screens
(https://claude.ai/artifact/4Hih2a8SkFWcH3jXAodL26). It replaces the old phone apps (app-v2 and mobile, removed 16 Nov 2026):
same Android id (`dev.fawadiqbal.rfqdesk`), so it installs as an update when signed with the same key.

Built step by step; each step is a pull request, reviewed and approved before the next.

| Step | What | Version |
|---|---|---|
| 1 | Foundations: structure, Kestrel tokens, theme, feel, versions and releases | 3.0.0-alpha.1 |
| 2 | Every Kestrel component | alpha.2 |
| 3 | Core: API, sign-in (two-step, company), offline cache and outbox | alpha.3 |
| 4 | Home, alerts, the five tabs, More | alpha.4 |
| 5 | Sales: inquiries, quotation (Internal / Customer), new inquiry | alpha.5 |
| 6 | Orders: where it stands, money, lines, papers, files, delivery and SAT | alpha.6 |
| 7 | Money: to collect, payables, accounts, money received, expenses (with proof) | alpha.7 |
| 8 | Customers and factories, search, file viewer | alpha.8 |
| 9 | Push notifications | 3.0.0-beta.1 |

Still on the web (the app opens them there): factory price requests and offers, the quotation editor,
making papers, paying factories, transfers, approving submissions.

## How it is built

```
lib/
  main.dart              starts the app
  app/                   the app shell: theme mode, router (every route in one place)
  design/                Kestrel in Flutter — screens import design/design.dart only
    tokens.g.dart        GENERATED from design/kestrel.tokens.json (never edit)
    theme.dart           ThemeData + context.k (the semantic colours)
    feel.dart            motion (durations, curves, reduce-motion), haptics, greeting
    icons.dart           the 48 Kestrel line icons
    components/          one widget per Kestrel component
  features/<feature>/    one folder per area (gallery today; home, sales, orders, money… next)
    data/                API calls and models for the feature
    domain/              rules that do not depend on Flutter
    presentation/        screens and widgets
design/kestrel.tokens.json   the design system's tokens (copy; the artifact is the source)
tool/                         gen_tokens.dart, version.dart
test/                         mirrors lib/ and tool/
```

### Principles
- **One source for every value.** Colours, type, spacing, sizes come from the Kestrel tokens; CI fails if
  `tokens.g.dart` does not match them. No hex or pixel values typed in a screen.
- **Screens are thin.** Widgets show state and send intents; rules live in `domain/`, data in `data/`
  (Riverpod providers between them). Nothing in `domain/` imports Flutter.
- **Design rules are code, not advice.** A button can't be pressed twice while busy; icon buttons need a
  label; banners only dismiss when allowed; every tappable thing is at least 48 × 48; status always has an icon.
- **Accessible by default.** Every pressable is its own screen-reader node with name, role and state;
  focus is visible; reduce-motion turns animations off everywhere; contrast is tested (AA, both themes).
- **Feel, with restraint.** Every tap springs and gives a light haptic. Big moments (payment sent, deal won)
  get a success check or a small celebration. Nothing else moves for its own sake.
- **Tests with every change.** Token contrast, component behaviour, version rules, the app opening.

## Commands (in apps/phone)

```sh
flutter pub get
dart run tool/gen_tokens.dart          # after changing design/kestrel.tokens.json
flutter analyze && flutter test
flutter run                            # opens the design gallery (step 1)
```

## Versions and releases

**One version, in `pubspec.yaml`:** `version: <semver>+<build>`.
- semver: `3.1.0`, or a pre-release `3.1.0-alpha.2`, `-beta.1`, `-rc.1`.
- build (Android versionCode) is worked out from the semver, never typed by hand, so every newer version
  has a higher build and installs as an update: `MAJOR·1,000,000 + MINOR·10,000 + PATCH·100 + stage`
  (alpha N = N, beta N = 30+N, rc N = 60+N, release = 99). 3.0.0-alpha.1 is 3000001; 3.0.0 is 3000099.
- Every version has a `## <version>` section in `CHANGELOG.md`: it becomes the release notes.

```sh
dart run tool/version.dart                  # show version, build, tag
dart run tool/version.dart bump alpha       # 3.0.0-alpha.1 → 3.0.0-alpha.2 (also: beta, rc, release, patch, minor, major)
dart run tool/version.dart check            # what CI runs
```

**To release:**
1. `dart run tool/version.dart bump <part>`, write the CHANGELOG entry, open a PR, merge it.
2. GitHub › **Actions** › **Phone release** › **Run workflow** (branch `main`). It releases the version in
   `pubspec.yaml` and makes the tag `phone-v<version>` itself. (Or push that tag yourself:
   `git tag phone-v<version> && git push origin phone-v<version>`.) A version already released is refused.
3. The **Phone release** workflow checks the tag against pubspec and the changelog, runs the tests, builds
   the APK, refuses a debug-signed one, and publishes a GitHub release with `rfq-desk-<version>.apk`,
   its SHA-256 and the notes. Pre-releases (`-alpha`, `-beta`, `-rc`) are marked as such.

Every pull request also builds a **test APK** (debug-signed), attached to the CI run as `rfq-desk-test-apk`.

**The release key (once, by Fawad).** Keep the `.jks` and its passwords safe: an app signed with another key
can't update this one.

```sh
keytool -genkeypair -v -keystore release.jks -alias rfqdesk -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 release.jks     # paste into the secret ANDROID_KEYSTORE_BASE64
```

Repository secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`rfqdesk`),
`ANDROID_KEY_PASSWORD`. If the old app was installed from a release-signed APK, use **that** key so v3 updates it.

## Push notifications (once, by Fawad)

The Firebase project behind push knows the old app id `com.keboint.rfqdesk`; this app is
`dev.fawadiqbal.rfqdesk` (the old app-v2's id, so it updates it). In the Firebase console, add an Android
app with package `dev.fawadiqbal.rfqdesk` to the same project and put its `google-services.json` in
`apps/phone/android/app/`. The build applies the Google services plugin only when that file is there,
so without it the app builds and runs with push off. The server side (`POST/DELETE /api/me/devices`)
is the one the old app already uses.

## iPhone

The `ios/` project is generated and builds; shipping needs an Apple developer account, a bundle id,
signing, an APNs key in Firebase and `GoogleService-Info.plist`.
