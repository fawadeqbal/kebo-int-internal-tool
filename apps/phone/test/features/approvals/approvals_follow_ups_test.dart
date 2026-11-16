import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rfq_desk/app/app.dart';
import 'package:rfq_desk/app/router.dart';
import 'package:rfq_desk/core/bell.dart';
import 'package:rfq_desk/core/providers.dart';
import 'package:rfq_desk/design/design.dart';

import '../../support/fake_server.dart';

Map<String, Object?> _answers() => {
  '/api/submissions': {
    'counts': {'pending': 1, 'sent_back': 0},
    'rows': [
      {
        'id': 's1',
        'kind': 'payment',
        'status': 'pending',
        'amount': '19280.00',
        'currency': 'USD',
        'paidOn': '2026-11-15',
        'method': 'bank_transfer',
        'reference': 'MT103-55',
        'order': {'id': 'o1', 'refNo': 'SO-2026-0035', 'customer': 'Kabul Medical Supplies'},
        'body': {'note': 'Balance'},
        'submittedBy': {'name': 'Bilal'},
        'submittedAt': '2026-11-15T09:00:00Z',
        'hasFile': true,
        'file': {'id': 'f1', 'name': 'slip.jpg'},
        'can': {'approve': true, 'sendBack': true},
      },
    ],
  },
  '/api/submissions/s1/approve': {'createdId': 'p1'},
  '/api/submissions/s1/send-back': {'ok': true},
  '/api/follow-ups': {'id': 'fu1'},
  '/api/me/today': {'rows': <Object?>[]},
  '/api/reminders': {
    'items': <Object?>[],
    'counts': {'total': 0},
  },
  '/api/notifications': {'unread': 0},
};

Future<FakeServer> _open(WidgetTester t, String at) async {
  KHaptics.enabled = false;
  Bell.autoRefresh = false;
  t.view.physicalSize = const Size(390 * 3, 844 * 3);
  t.view.devicePixelRatio = 3;
  addTearDown(t.view.reset);
  final (s, server) = fakeSession(_answers());
  addTearDown(s.api.net.stop);
  final container = ProviderContainer(overrides: [sessionProvider.overrideWith((ref) => s)]);
  addTearDown(container.dispose);
  await t.pumpWidget(UncontrolledProviderScope(container: container, child: const RfqDeskApp()));
  container.read(routerProvider).go(at);
  await t.pumpAndSettle();
  return server;
}

Future<void> _tap(WidgetTester t, String text) async {
  await t.ensureVisible(find.text(text).last);
  await t.pumpAndSettle();
  await t.tap(find.text(text).last);
  await t.pumpAndSettle();
}

void main() {
  testWidgets('approve a payment sent for approval', (t) async {
    final server = await _open(t, '/approvals');
    expect(find.text('Waiting (1)'), findsOneWidget);
    expect(find.text('Yours to decide'), findsOneWidget);
    await _tap(t, 'Money received · USD 19,280.00');
    expect(find.text('MT103-55'), findsOneWidget);
    expect(find.text('Open the slip'), findsOneWidget);
    await _tap(t, 'Approve · the receipt is made');
    expect(server.calls.any((c) => c.path == '/api/submissions/s1/approve'), isTrue);
  });

  testWidgets('send back needs a reason', (t) async {
    final server = await _open(t, '/approvals');
    await _tap(t, 'Money received · USD 19,280.00');
    await _tap(t, 'Send back');
    await _tap(t, 'Send back');
    expect(find.text('Say why, so they can fix it.'), findsOneWidget);
    await t.enterText(find.widgetWithText(KTextField, 'Why'), 'Slip shows 18,900');
    await _tap(t, 'Send back');
    expect(server.sent('POST', '/api/submissions/s1/send-back'), {'reason': 'Slip shows 18,900'});
  });

  testWidgets('plan a follow-up from Home', (t) async {
    final server = await _open(t, '/home');
    await _tap(t, 'Plan');
    await _tap(t, 'Plan it');
    expect(find.textContaining('Say what to do'), findsOneWidget);
    await t.enterText(find.widgetWithText(KTextField, 'What to do'), 'Call Herat Pharma');
    await _tap(t, 'Visit');
    await t.enterText(find.widgetWithText(KTextField, 'Where'), 'Herat');
    await _tap(t, 'Plan it');
    final body = server.sent('POST', '/api/follow-ups')!;
    expect(body['title'], 'Call Herat Pharma');
    expect(body['kind'], 'visit');
    expect(body['place'], 'Herat');
    expect(body['dueOn'], isA<String>());
  });
}
