import 'package:flutter/material.dart';

import 'dart:ui' show SemanticsFlag;

import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rfq_desk/design/design.dart';

Widget host(Widget child, {bool dark = false, bool reduceMotion = false}) => MaterialApp(
  theme: KTheme.light(),
  darkTheme: KTheme.dark(),
  themeMode: dark ? ThemeMode.dark : ThemeMode.light,
  home: MediaQuery(
    data: MediaQueryData(disableAnimations: reduceMotion),
    child: Scaffold(body: Center(child: child)),
  ),
);

void main() {
  setUp(() => KHaptics.enabled = false);

  testWidgets('KButton: taps once, is a 48+ target, and says so when busy', (t) async {
    var taps = 0;
    await t.pumpWidget(host(KButton('Save address', onPressed: () => taps++)));
    await t.tap(find.text('Save address'));
    await t.pumpAndSettle();
    expect(taps, 1);
    expect(t.getSize(find.byType(Pressable)).height, greaterThanOrEqualTo(KSize.touch));
    expect(find.bySemanticsLabel('Save address'), findsOneWidget);

    await t.pumpWidget(host(KButton('Saving', loading: true, onPressed: () => taps++)));
    await t.tap(find.text('Saving'), warnIfMissed: false);
    await t.pump(const Duration(milliseconds: 50));
    expect(taps, 1, reason: 'a busy button cannot be pressed twice');
    expect(find.bySemanticsLabel('Saving, in progress'), findsOneWidget);
  });

  testWidgets('KButton disabled is announced as disabled', (t) async {
    final h = t.ensureSemantics();
    await t.pumpWidget(host(const KButton('Continue', onPressed: null)));
    final node = t.getSemantics(find.byType(Pressable));
    final data = node.getSemanticsData();
    // ignore: deprecated_member_use
    expect(data.hasFlag(SemanticsFlag.hasEnabledState), isTrue);
    // ignore: deprecated_member_use
    expect(data.hasFlag(SemanticsFlag.isEnabled), isFalse);
    h.dispose();
  });

  testWidgets('KIconButton: label is required and the badge is read as "N new"', (t) async {
    await t.pumpWidget(host(KIconButton(KIcons.bell, label: 'Notifications', badge: 3, onPressed: () {})));
    expect(find.bySemanticsLabel('Notifications, 3 new'), findsOneWidget);
    expect(find.text('3'), findsOneWidget);
    expect(t.getSize(find.byType(KIconButton)).width, greaterThanOrEqualTo(KSize.touch));
    await t.pumpWidget(host(KIconButton(KIcons.bell, label: 'Notifications', badge: 120, onPressed: () {})));
    expect(find.text('99+'), findsOneWidget);
  });

  testWidgets('KBadge: status tones carry an icon; the Internal tag has the lock', (t) async {
    await t.pumpWidget(
      host(
        const Column(
          children: [
            KBadge('Delivered', tone: KTone.success),
            KBadge('Draft'),
            KBadge.internal(),
          ],
        ),
      ),
    );
    expect(find.descendant(of: find.widgetWithText(KBadge, 'Delivered'), matching: find.byType(KIcon)), findsOneWidget);
    expect(find.descendant(of: find.widgetWithText(KBadge, 'Draft'), matching: find.byType(KIcon)), findsNothing);
    final lock = t.widget<KIcon>(
      find.descendant(of: find.widgetWithText(KBadge, 'Internal'), matching: find.byType(KIcon)),
    );
    expect(lock.icon, KIcons.lock);
  });

  testWidgets('KAvatar: initials and presence in the label', (t) async {
    await t.pumpWidget(host(const KAvatar('Kabul Medical Supplies', presence: KPresence.online)));
    expect(KAvatar.initials('Kabul Medical Supplies'), 'KM');
    expect(KAvatar.initials('  '), '?');
    expect(find.bySemanticsLabel('Kabul Medical Supplies, online'), findsOneWidget);
  });

  testWidgets('KBanner: only info and success can be dismissed', (t) async {
    await t.pumpWidget(
      host(
        Column(
          children: [
            KBanner('Info', onDismiss: () {}),
            KBanner('Danger', tone: KTone.danger, onDismiss: () {}),
          ],
        ),
      ),
    );
    expect(find.bySemanticsLabel('Dismiss'), findsOneWidget);
  });

  testWidgets('reduce motion: durations collapse and the success check appears drawn', (t) async {
    late KMotion m;
    await t.pumpWidget(
      host(
        Builder(
          builder: (c) {
            m = KMotion.of(c);
            return const SuccessCheck(label: 'Verified');
          },
        ),
        reduceMotion: true,
      ),
    );
    expect(m.reduced, isTrue);
    expect(m.standard, Duration.zero);
    expect(find.bySemanticsLabel('Verified'), findsOneWidget);
    await t.pump();
    expect(t.hasRunningAnimations, isFalse);
  });

  testWidgets('every component renders in dark too', (t) async {
    await t.pumpWidget(
      host(
        Column(
          children: [
            KButton('Primary', onPressed: () {}),
            KIconButton(KIcons.search, label: 'Search', onPressed: () {}),
            const KBadge('Failed', tone: KTone.danger),
            const KBanner('Offline', tone: KTone.warning),
            const KSkeleton(width: 100),
          ],
        ),
        dark: true,
        reduceMotion: true,
      ),
    );
    expect(t.takeException(), isNull);
  });

  test('greeting follows the time of day', () {
    expect(greeting(DateTime(2026, 11, 16, 9), 'Fawad'), 'Good morning, Fawad');
    expect(greeting(DateTime(2026, 11, 16, 14), 'Fawad'), 'Good afternoon, Fawad');
    expect(greeting(DateTime(2026, 11, 16, 20), 'Fawad'), 'Good evening, Fawad');
    expect(greeting(DateTime(2026, 11, 16, 2), 'Fawad'), 'Working late, Fawad');
  });
}
