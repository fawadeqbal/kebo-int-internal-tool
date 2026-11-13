import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kebo_app/custom/factory_visit.dart';
import 'package:kebo_app/custom/waiting.dart';

import '../support/harness.dart';
import 'phase5_test.dart' show phase5Order, visitServer;

/// No signal now (the probe says so too, and never waits on a timer in tests).
void _noSignal() {
  lastServer.offline = true;
  lastSession.api.net
    ..probe = (() async => !lastServer.offline)
    ..probeEvery = const Duration(days: 1)
    ..lost();
}

void main() {
  testWidgets('the banner says what waits and how old the pages are; tap opens Waiting to send', (tester) async {
    await pumpScreen(tester, const OfflineBanner(child: Scaffold(body: Center(child: Text('Orders')))), {});
    expect(find.textContaining('No signal'), findsNothing);
    _noSignal();
    lastSession.api.net.servedFromCache(DateTime.now().subtract(const Duration(minutes: 5)));
    await (lastSession.outbox.chain('Expense · CNY 320')..post('/api/expenses', {'amount': '320'})).send();
    await tester.pumpAndSettle();
    expect(find.text('No signal · 1 thing waiting to send · they go when you are back online'), findsOneWidget);
    expect(find.textContaining('Offline · as of '), findsOneWidget);
    expect(find.text('Orders'), findsOneWidget);
    await expectAccessible(tester);
    await tester.tap(find.textContaining('No signal'));
    await tester.pumpAndSettle();
    expect(find.text('Opened /waiting'), findsOneWidget);
    lastSession.api.net.stop();
  });

  testWidgets('Waiting to send: what waits, what needs you (Try again, Remove), and Changed by someone else', (tester) async {
    final answers = <String, Object?>{
      '/api/orders/o1/flow': {
        'factory': {
          'readyBy': [
            {'factoryId': 'f1', 'readyOn': '2026-11-25'},
          ],
        },
      },
      '/api/orders/o1/details': {'ok': true},
    };
    await pumpScreen(tester, const WaitingScreen(), answers);
    expect(find.text('Nothing waiting'), findsOneWidget);
    _noSignal();
    final box = lastSession.outbox;
    await (box.chain('Snap · SO-2026-0447')..upload('/api/orders/o1/files', Uint8List.fromList([1, 2, 3]), 'p.jpg')).send();
    await (box.chain('Factory visit · SO-2026-0447')
          ..patch('/api/orders/o1/details', {'readyBy': []},
              guard: {'get': '/api/orders/o1/flow', 'list': 'factory.readyBy', 'where': {'factoryId': 'f1'}, 'field': 'readyOn', 'was': '2026-11-20', 'yours': '2026-12-01'}))
        .send();
    await tester.pumpAndSettle();
    expect(find.text('Waiting to send · 2'), findsOneWidget);
    expect(find.text('Waiting'), findsNWidgets(2));
    await expectAccessible(tester);

    // Back online: the photo's endpoint is refused, the visit meets someone else's date.
    lastServer.offline = false;
    await lastSession.api.net.check();
    await tester.pumpAndSettle();
    expect(find.text('Needs you'), findsOneWidget);
    expect(find.text('Changed by someone else'), findsOneWidget);
    await tester.tap(find.text('Choose…'));
    await tester.pumpAndSettle();
    expect(find.text('1 Dec 2026'), findsOneWidget, reason: 'yours');
    expect(find.text('25 Nov 2026'), findsOneWidget, reason: 'now on the server');
    await tester.tap(find.text('Keep mine'));
    await tester.pumpAndSettle();
    expect(lastServer.calls.any((c) => c.method == 'PATCH' && c.path == '/api/orders/o1/details'), isTrue);

    await tester.tap(find.text('Remove'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Remove'));
    await tester.pumpAndSettle();
    expect(find.text('Nothing waiting'), findsOneWidget);
    expect(box.waiting, 0);
    lastSession.api.net.stop();
  });

  testWidgets('a factory visit with no signal is kept on the phone, then sent in order', (tester) async {
    final answers = visitServer()
      ..['/api/orders/o1/details'] = {'ok': true}
      ..['/api/orders/o1/files'] = {'id': 'a1', 'sourceId': 's9'};
    await pumpSheet(tester, (c) => openFactoryVisit(c, phase5Order), answers: answers, permissions: const {'orders.update'});
    _noSignal();
    await tester.pumpAndSettle();
    await tester.tap(find.text('Passed'));
    await tester.enterText(find.byType(TextField).first, 'Label alignment ok');
    await tester.pumpAndSettle();
    expect(find.text('Save · sends when online'), findsOneWidget);
    final before = lastServer.calls.length;
    await tester.tap(find.text('Save · sends when online'));
    await tester.pumpAndSettle();
    expect(lastServer.calls.length, before, reason: 'nothing reached the server');
    expect(find.text('Saved on the phone · 1 thing will send when online'), findsOneWidget);
    expect(lastSession.outbox.steps.map((s) => s.path), ['/api/orders/o1/factory-facts']);

    lastServer.offline = false;
    await lastSession.api.net.check();
    await tester.pumpAndSettle();
    // (Back online also reads the day's work again to keep it: GETs, left out here.)
    expect([for (final c in lastServer.calls.skip(before)) if (c.method != 'GET') '${c.method} ${c.path}'], ['PUT /api/orders/o1/factory-facts']);
    expect(lastServer.sent('PUT', '/api/orders/o1/factory-facts')!['fatResult'], 'passed');
    expect(lastSession.outbox.waiting, 0);
    lastSession.api.net.stop();
  });

  testWidgets('kept answers carry the visit when there is no signal from the start', (tester) async {
    // Opened once online (kept), then the signal goes and it opens again from the phone.
    await pumpSheet(tester, (c) => openFactoryVisit(c, phase5Order), answers: visitServer(), permissions: const {'orders.update'});
    await tester.tap(find.byTooltip('Close'));
    await tester.pumpAndSettle();
    _noSignal();
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
    expect(find.text('Factory visit'), findsOneWidget);
    expect(find.text('20 Nov 2026'), findsOneWidget);
    lastSession.api.net.stop();
  });
}
