import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rfq_desk/app/app.dart';
import 'package:rfq_desk/core/bell.dart';
import 'package:rfq_desk/core/providers.dart';
import 'package:rfq_desk/core/session.dart';
import 'package:rfq_desk/design/design.dart';

import '../../support/fake_server.dart';

Map<String, Object?> _answers({int unread = 2}) => {
  '/api/reminders': {
    'counts': {'total': 5},
    'items': [
      {
        'title': 'USD 12,400 overdue from Herat Pharma',
        'detail': 'SO-2026-0031 · 9 days late',
        'level': 'bad',
        'href': '/orders/x',
      },
      {'title': 'B/L not in yet', 'detail': 'SO-2026-0035', 'level': 'warn'},
    ],
  },
  '/api/me/today': {
    'rows': [
      {
        'id': 'f1',
        'title': 'Call Kabul Medical about the price',
        'dueOn': '2026-11-16',
        'dueAt': '11:00',
        'late': true,
        'target': {'label': 'INQ-2026-0218'},
        'can': {'done': true},
      },
    ],
  },
  '/api/dashboard': {
    'money': {
      'currency': 'USD',
      'thisMonth': {'won': '48200', 'received': '28920', 'quoted': '120000'},
      'now': {'toReceive': '19280', 'openOrders': 8},
    },
  },
  '/api/me/target': {'target': '100000', 'percent': 48},
  '/api/notifications': {
    'unread': unread,
    'total': 2,
    'items': [
      {
        'id': 'n1',
        'title': 'Payment verified',
        'body': 'USD 5,000 from Herat Pharma',
        'type': 'payment.verified',
        'createdAt': DateTime.now().toIso8601String(),
      },
      {
        'id': 'n2',
        'title': 'Order shipped',
        'body': 'SO-2026-0035 left Qingdao',
        'type': 'order.shipped',
        'createdAt': DateTime.now().toIso8601String(),
        'readAt': '2026-11-15T10:00:00Z',
      },
    ],
  },
  '/api/notifications/read': {'ok': true},
  '/api/follow-ups/f1/done': {'ok': true},
  '/api/health': {'ok': true},
};

Future<(Session, FakeServer)> _open(WidgetTester t, Map<String, Object?> answers) async {
  KHaptics.enabled = false;
  Bell.autoRefresh = false;
  t.view.physicalSize = const Size(390 * 3, 844 * 3);
  t.view.devicePixelRatio = 3;
  addTearDown(t.view.reset);
  final (s, server) = fakeSession(answers);
  s.me = const Me(
    id: 'me',
    name: 'Fawad Iqbal',
    email: 'f@example.com',
    role: 'Owner',
    company: 'Kebo International',
    permissions: {'*'},
  );
  addTearDown(s.api.net.stop);
  final container = ProviderContainer(overrides: [sessionProvider.overrideWith((ref) => s)]);
  addTearDown(container.dispose);
  await t.pumpWidget(UncontrolledProviderScope(container: container, child: const RfqDeskApp()));
  await t.pumpAndSettle();
  return (s, server);
}

void main() {
  testWidgets('Home: greeting, what needs me, today, this month, bell count', (t) async {
    await _open(t, _answers());
    expect(find.textContaining('Fawad'), findsWidgets);
    expect(find.text('5 things need you'), findsOneWidget);
    expect(find.text('USD 12,400 overdue from Herat Pharma'), findsOneWidget);
    expect(find.text('All 5'), findsOneWidget);
    expect(find.bySemanticsLabel('Notifications, 2 new'), findsOneWidget);
    await t.scrollUntilVisible(find.text('This month'), 300, scrollable: find.byType(Scrollable).first);
    expect(find.text('Call Kabul Medical about the price'), findsOneWidget);
    expect(find.text('USD 48.2k'), findsOneWidget);
    expect(find.text('48% of target'), findsOneWidget);
  });

  testWidgets('a follow-up is marked done from Home', (t) async {
    final (_, server) = await _open(t, _answers());
    await t.scrollUntilVisible(find.text('Done'), 300, scrollable: find.byType(Scrollable).first);
    await t.tap(find.text('Done'));
    await t.pumpAndSettle();
    await t.enterText(find.widgetWithText(KTextField, 'What happened'), 'They want it by Friday');
    await t.tap(find.text('Mark as done').last);
    await t.pumpAndSettle();
    expect(server.sent('POST', '/api/follow-ups/f1/done'), {'note': 'They want it by Friday'});
    expect(find.text('Done: Call Kabul Medical about the price'), findsOneWidget);
  });

  testWidgets('the bell opens alerts; mark all read clears the count', (t) async {
    final (_, server) = await _open(t, _answers());
    await t.tap(find.bySemanticsLabel('Notifications, 2 new'));
    await t.pumpAndSettle();
    expect(find.text('Payment verified'), findsOneWidget);
    expect(find.text('Today'), findsOneWidget);
    expect(find.text('New'), findsOneWidget);
    await t.tap(find.bySemanticsLabel('Mark all as read'));
    await t.pumpAndSettle();
    expect(server.sent('POST', '/api/notifications/read'), {'ids': 'all'});
    expect(find.text('New'), findsNothing);
  });

  testWidgets('tabs: each opens, More shows the account and theme', (t) async {
    await _open(t, _answers(unread: 0));
    for (final tab in ['Orders', 'Money']) {
      await t.tap(find.text(tab).last);
      await t.pumpAndSettle();
      expect(find.textContaining('$tab arrives in step'), findsOneWidget);
    }
    await t.tap(find.text('More').last);
    await t.pumpAndSettle();
    expect(find.text('f@example.com'), findsOneWidget);
    await t.tap(find.text('Dark'));
    await t.pumpAndSettle();
    expect(Theme.of(t.element(find.text('Appearance'))).brightness, Brightness.dark);
    expect(t.takeException(), isNull);
  });

  testWidgets('offline: Home says so and the header shows stale time', (t) async {
    final answers = _answers();
    final (s, server) = await _open(t, answers);
    server.offline = true;
    // The probe has a real network timeout, so it runs on the real clock.
    await t.runAsync(() => s.api.net.check());
    await t.pumpAndSettle();
    expect(find.textContaining('Offline ·'), findsWidgets);
    expect(find.text("You're offline"), findsOneWidget);
    s.api.net.stop(); // no retry timer outlives the test
  });
}
