import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rfq_desk/app/app.dart';
import 'package:rfq_desk/app/router.dart';
import 'package:rfq_desk/core/bell.dart';
import 'package:rfq_desk/core/providers.dart';
import 'package:rfq_desk/design/design.dart';

import '../../support/fake_server.dart';

const _id = '11111111-2222-3333-4444-555555555555';

Map<String, Object?> _answers() => {
  '/api/inquiries/$_id': {
    'id': _id,
    'refNo': 'INQ-2026-0218',
    'title': 'Tablet press',
    'stage': 'sourcing',
    'items': [
      {'id': 'it1', 'no': '1', 'description': 'Rotary tablet press', 'model': 'ZP-35', 'quantity': '1', 'unit': 'set'},
    ],
  },
  '/api/inquiries/$_id/factory-requests': {
    'counts': {'asked': 2, 'quoted': 1, 'waiting': 1, 'late': 1},
    'items': [
      {
        'id': 'r1',
        'factory': {'id': 'f1', 'name': 'Shanghai Pharma Machinery'},
        'status': 'quoted',
        'statusLabel': 'Quoted',
      },
      {
        'id': 'r2',
        'factory': {'id': 'f2', 'name': 'Wenzhou Pack'},
        'status': 'sent',
        'statusLabel': 'Waiting',
        'late': true,
        'waitingDays': 6,
        'channel': 'wechat',
      },
    ],
    'suggestions': [
      {'id': 'f1', 'name': 'Shanghai Pharma Machinery', 'askedHere': true, 'offers': 4},
      {'id': 'f3', 'name': 'Ruian Machinery', 'askedHere': false, 'offers': 1},
    ],
  },
  '/api/inquiries/$_id/sourcing': {
    'quotes': [
      {
        'id': 'q1',
        'factory': {'name': 'Shanghai Pharma Machinery'},
        'currency': 'CNY',
        'factoryTotal': '281000.00',
        'receivedOn': '2026-11-12',
        'leadTime': '45 days',
        'lines': [<String, Object?>{}],
        'unpriced': 0,
      },
    ],
  },
  '/api/factory-requests/r2': {'ok': true},
  '/api/inquiries/$_id/factory-quotes': {'id': 'q2'},
  '/api/notifications': {'unread': 0},
};

Future<FakeServer> _open(WidgetTester t) async {
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
  container.read(routerProvider).go('/sales/inquiry/$_id/prices');
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
  testWidgets('who was asked, who answered, the offers', (t) async {
    await _open(t);
    expect(find.text('Waiting 6 d'), findsOneWidget);
    expect(find.text('Quoted'), findsOneWidget);
    expect(find.textContaining('CNY 281,000.00'), findsOneWidget);
  });

  testWidgets('ask another factory', (t) async {
    final server = await _open(t);
    await _tap(t, 'Ask factories');
    expect(find.text('Shanghai Pharma Machinery'), findsWidgets); // in the list behind
    await _tap(t, 'Ruian Machinery');
    await _tap(t, 'Ask 1 factory');
    expect(server.sent('POST', '/api/inquiries/$_id/factory-requests')?['factoryIds'], ['f3']);
  });

  testWidgets('a waiting factory declined', (t) async {
    final server = await _open(t);
    await _tap(t, 'Wenzhou Pack');
    await _tap(t, 'They declined');
    expect(server.sent('PATCH', '/api/factory-requests/r2'), {'status': 'declined'});
  });

  testWidgets('an offer with a price per item', (t) async {
    final server = await _open(t);
    await _tap(t, 'Add an offer');
    await _tap(t, 'Choose the factory');
    await _tap(t, 'Ruian Machinery');
    await t.enterText(find.widgetWithText(KTextField, '1 Rotary tablet press'), '265000');
    await _tap(t, 'Save the offer');
    final body = server.sent('POST', '/api/inquiries/$_id/factory-quotes')!;
    expect(body['factoryId'], 'f3');
    expect((body['lines'] as List).single, containsPair('unitPrice', '265000'));
    expect((body['lines'] as List).single, containsPair('requestedItemId', 'it1'));
  });
}
