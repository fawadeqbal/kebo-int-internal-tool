import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rfq_desk/app/app.dart';
import 'package:rfq_desk/app/router.dart';
import 'package:rfq_desk/core/bell.dart';
import 'package:rfq_desk/core/providers.dart';
import 'package:rfq_desk/core/session.dart';
import 'package:rfq_desk/design/design.dart';

import '../../support/fake_server.dart';

const _id = '99999999-2222-3333-4444-555555555555';

Map<String, Object?> _answers() => {
  '/api/orders/page': {
    'total': 1,
    'counts': {'open': 8, 'late': 2, 'shipped': 3, 'confirmed': 2, 'in_production': 3, 'closed': 40, 'cancelled': 1},
    'rows': [
      {
        'id': _id,
        'refNo': 'SO-2026-0035',
        'word': 'Shipped',
        'customer': {'name': 'Kabul Medical Supplies'},
        'inquiry': {'title': 'Tablet press, 35 stations'},
        'currency': 'USD',
        'total': '48200.00',
        'due': '19280.00',
        'needs': {'title': 'Balance due', 'due': '2026-11-10', 'late': true},
      },
    ],
  },
  '/api/orders/$_id': {
    'id': _id,
    'refNo': 'SO-2026-0035',
    'status': 'open',
    'word': 'Shipped',
    'customer': {'name': 'Kabul Medical Supplies'},
    'inquiry': {'id': 'inq1', 'title': 'Tablet press, 35 stations'},
    'currency': 'USD',
    'money': {
      'total': '48200.00',
      'received': '28920.00',
      'due': '19280.00',
      'deposit': '14460.00',
      'depositPercent': 30,
      'bankCharges': '25.00',
    },
    'needs': {'title': 'Balance due', 'due': '2026-11-10', 'late': true},
    'lines': [
      {
        'no': '1',
        'description': 'Rotary tablet press',
        'model': 'ZP-35',
        'quantity': '1',
        'unit': 'set',
        'lineTotal': '48200.00',
      },
    ],
  },
  '/api/orders/$_id/sections': {
    'stands': [
      {'stage': 'payment', 'label': 'Payment', 'word': 'Deposit in', 'tone': 'ok', 'fact': 'USD 28,920 of 48,200'},
      {
        'stage': 'shipping',
        'label': 'Shipping',
        'word': 'Shipped',
        'tone': 'info',
        'fact': 'Left Qingdao 2 Nov',
        'missing': 'B/L not in yet',
      },
      {'stage': 'delivery', 'label': 'Delivery & SAT', 'word': 'Not yet', 'tone': 'neutral'},
    ],
  },
  '/api/orders/$_id/papers': {
    'papers': [
      {
        'key': 'contract',
        'kind': 'contract',
        'label': 'Sales contract',
        'number': 'SC-2026-0035',
        'state': 'ready',
        'stateLabel': 'Ready',
        'makeable': true,
      },
      {'key': 'bl', 'kind': 'bl', 'label': 'Bill of lading', 'state': 'miss', 'stateLabel': 'Missing'},
    ],
  },
  '/api/orders/$_id/files': {
    'files': [
      {'id': 'f1', 'name': 'loading-photo.jpg', 'size': 1840000, 'kindLabel': 'Photo', 'href': '/files/f1'},
    ],
  },
  '/api/orders/$_id/delivery/all-good': {'ok': true},
  '/api/orders/$_id/papers/invoice/checks': {
    'refNo': 'SO-2026-0035',
    'kind': 'invoice',
    'label': 'Commercial invoice',
    'canMake': true,
    'checks': [
      {'key': 'lines', 'label': 'Items', 'value': '1 item · USD 48,200', 'ok': true, 'required': true},
      {'key': 'bl', 'label': 'B/L number', 'value': 'Missing', 'ok': false, 'required': true, 'fix': 'blNo'},
    ],
    'fixes': {
      'blNo': {'label': 'B/L number', 'type': 'text', 'saves': 'the shipment'},
    },
    'options': [
      {'key': 'stamp', 'label': 'Our stamp', 'on': true},
    ],
    'paper': null,
    'versions': <Object?>[],
  },
  '/api/orders/$_id/papers/invoice/fix': {'ok': true},
  '/api/orders/$_id/papers/invoice': {'ok': true},
  '/api/notifications': {'unread': 0},
};

Future<(Session, FakeServer)> _open(WidgetTester t, String at) async {
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
  return (s, server);
}

Finder _list() => find.byType(Scrollable).hitTestable().first;

void main() {
  testWidgets('Orders: counts, late first, what each needs', (t) async {
    await _open(t, '/orders');
    expect(find.text('8 open · 2 late · 3 on the way'), findsOneWidget);
    expect(find.text('Tablet press, 35 stations'), findsOneWidget);
    expect(find.widgetWithText(KBadge, 'Late'), findsOneWidget);
    expect(find.textContaining('USD 19.3k due'), findsOneWidget);
  });

  testWidgets('an order: header, next, where it stands, money, documents, files', (t) async {
    await _open(t, '/orders/order/$_id');
    expect(find.text('Sales order · SO-2026-0035'), findsOneWidget);
    expect(find.textContaining('Balance due'), findsWidgets);
    expect(find.text('B/L not in yet'), findsOneWidget);
    await t.scrollUntilVisible(find.text('Bank charges'), 300, scrollable: _list());
    expect(find.text('USD 25.00'), findsOneWidget);
    await t.scrollUntilVisible(find.text('Missing'), 300, scrollable: _list());
    expect(find.text('Ready'), findsOneWidget);
    await t.scrollUntilVisible(find.text('loading-photo.jpg'), 300, scrollable: _list());
  });

  testWidgets('delivered in full is sent with its day', (t) async {
    final (_, server) = await _open(t, '/orders/order/$_id');
    await t.scrollUntilVisible(find.text('Delivered in full'), 300, scrollable: _list());
    await t.drag(_list(), const Offset(0, -200));
    await t.pumpAndSettle();
    await t.tap(find.text('Delivered in full'));
    await t.pumpAndSettle();
    await t.tap(find.text('Mark delivered'));
    await t.pumpAndSettle();
    expect(server.sent('POST', '/api/orders/$_id/delivery/all-good')?['deliveredOn'], isA<String>());
  });

  testWidgets('with no signal, delivered waits on the phone', (t) async {
    final (s, server) = await _open(t, '/orders/order/$_id');
    await t.scrollUntilVisible(find.text('Delivered in full'), 300, scrollable: _list());
    await t.drag(_list(), const Offset(0, -200));
    await t.pumpAndSettle();
    server.offline = true;
    s.api.net.offline = true;
    await t.tap(find.text('Delivered in full'));
    await t.pumpAndSettle();
    await t.tap(find.text('Mark delivered'));
    await t.pumpAndSettle();
    expect(s.outbox.waiting, 1);
    expect(find.textContaining('sent when you are back online'), findsOneWidget);
    await t.pumpWidget(const SizedBox());
    await t.pump(const Duration(seconds: 7));
  });

  testWidgets('a document: what is missing is added, then a draft is made', (t) async {
    final (_, server) = await _open(t, '/orders/order/$_id/paper/invoice');
    expect(find.text('1 thing missing before it can be made final.'), findsOneWidget);
    await t.tap(find.text('Add'));
    await t.pumpAndSettle();
    expect(find.text('Saved on the shipment, so every document uses it.'), findsOneWidget);
    await t.enterText(find.widgetWithText(KTextField, 'B/L number'), 'MSCU1234567');
    await t.tap(find.text('Save').last);
    await t.pumpAndSettle();
    expect(server.sent('POST', '/api/orders/$_id/papers/invoice/fix'), {'field': 'blNo', 'value': 'MSCU1234567'});
    await t.scrollUntilVisible(find.text('Make a draft'), 300, scrollable: _list());
    await t.tap(find.text('Make a draft'));
    await t.pumpAndSettle();
    expect(server.sent('POST', '/api/orders/$_id/papers/invoice'), {
      'options': {'stamp': true},
    });
  });
}
