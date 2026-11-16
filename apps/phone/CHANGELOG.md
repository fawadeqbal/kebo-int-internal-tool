# Changelog

RFQ Desk phone app (`apps/phone`). Newest first. Each `## <version>` section is the text of that GitHub release.
Versions and builds follow `tool/src/version.dart`; tags are `phone-v<version>`.

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
