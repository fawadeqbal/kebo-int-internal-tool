import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rfq_desk/app/app.dart';
import 'package:rfq_desk/app/router.dart';
import 'package:rfq_desk/core/bell.dart';
import 'package:rfq_desk/core/links.dart';
import 'package:rfq_desk/core/providers.dart';
import 'package:rfq_desk/design/design.dart';

import '../../support/fake_server.dart';

const _c = 'cccccccc-2222-3333-4444-555555555555';

Map<String, Object?> _answers() => {
  '/api/customers': {
    'rows': [
      {'id': _c, 'name': 'Kabul Medical Supplies', 'country': 'AF', 'openDeals': 2, 'openOrders': 1},
    ],
  },
  '/api/customers/$_c': {
    'id': _c,
    'name': 'Kabul Medical Supplies',
    'country': 'AF',
    'defaultCurrency': 'USD',
    'openDeals': 2,
    'openOrders': 1,
    'contacts': [
      {'id': 'k1', 'name': 'Dr. Noori', 'position': 'Director', 'phone': '+93 700 000 000', 'isPrimary': true},
    ],
    'inquiries': [
      {'id': 'i1', 'refNo': 'INQ-2026-0218', 'title': 'Tablet press', 'stage': 'quoted'},
    ],
  },
  '/api/factories': {
    'rows': [
      {'id': 'f1', 'name': 'Shanghai Pharma Machinery', 'contactPerson': 'Mr. Li'},
    ],
  },
  '/api/inquiries': {
    'rows': [
      {
        'id': 'i1',
        'refNo': 'INQ-2026-0218',
        'title': 'Tablet press',
        'stage': 'quoted',
        'customer': {'name': 'Kabul Medical Supplies'},
      },
    ],
  },
  '/api/orders/page': {'rows': <Object?>[]},
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

void main() {
  testWidgets('partners: customers and factories, a customer page', (t) async {
    await _open(t, '/partners');
    expect(find.text('Kabul Medical Supplies'), findsOneWidget);
    expect(find.text('2 open deals · 1 open orders'), findsOneWidget);
    await t.tap(find.text('Factories'));
    await t.pumpAndSettle();
    expect(find.text('Shanghai Pharma Machinery'), findsOneWidget);
    await t.tap(find.text('Customers'));
    await t.pumpAndSettle();
    await t.tap(find.text('Kabul Medical Supplies'));
    await t.pumpAndSettle();
    expect(find.text('Dr. Noori'), findsOneWidget);
    expect(find.text('Call'), findsOneWidget);
    expect(find.text('Tablet press'), findsWidgets);
  });

  testWidgets('search finds across inquiries and customers', (t) async {
    final server = await _open(t, '/search');
    await t.enterText(find.byType(TextField), 'kabul');
    await t.pump(const Duration(milliseconds: 400));
    await t.pumpAndSettle();
    expect(find.text('Inquiries'), findsOneWidget);
    expect(find.text('Customers'), findsOneWidget);
    expect(find.text('Orders'), findsNothing); // no hits there
    expect(server.calls.where((c) => c.queryParameters['q'] == 'kabul').length, 4);
  });

  test('web links open the right page', () {
    expect(appPathFor('/customers/$_c'), '/partners/customer/$_c');
    expect(appPathFor('/orders/$_c?tab=money'), '/orders/order/$_c');
    expect(appPathFor('/inquiries/$_c'), '/sales/inquiry/$_c');
    expect(appPathFor('/settings/company'), isNull);
  });
}
