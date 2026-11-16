# Changelog

RFQ Desk phone app (`apps/phone`). Newest first. Each `## <version>` section is the text of that GitHub release.
Versions and builds follow `tool/src/version.dart`; tags are `phone-v<version>`.

## 3.0.0-alpha.1 — 2026-11-16

First build of the new phone app (step 1: foundations). Not for daily use yet: it opens the design gallery.

- The Kestrel design system in the app: colours for light and dark, the type scale, spacing, corners, sizes and elevation, all generated from the design system's tokens.
- The feel: every tap springs softly and gives a light haptic; a success check that draws itself; a small celebration for the big wins. All of it follows the phone's "reduce motion" setting.
- First components: buttons, icon buttons with an unread count, badges (with the Internal tag), avatars, banners, loading skeletons and the 48 Kestrel icons.
- Versions, Android builds and GitHub releases: one version in pubspec.yaml, the Android build number worked out from it, and signed APKs attached to each release.
