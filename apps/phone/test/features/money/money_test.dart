import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rfq_desk/app/app.dart';
import 'package:rfq_desk/app/router.dart';
import 'package:rfq_desk/core/bell.dart';
import 'package:rfq_desk/core/picker.dart';
import 'package:rfq_desk/core/providers.dart';
import 'package:rfq_desk/core/session.dart';
import 'package:rfq_desk/design/design.dart';

import '../../support/fake_server.dart';

class _FakePicker implements Picker {
  _FakePicker(this.next);
  PickedFile next;
  @override
  Future<PickedFile?> photo() async => next;
  @override
  Future<PickedFile?> file() async => next;
}

Map<String, Object?> _answers() => {
  '/api/orders/page': {
    'rows': [
      {
        'id': 'o1',
        'refNo': 'SO-2026-0035',
        'currency': 'USD',
        'total': '48200.00',
        'due': '19280.00',
        'customer': {'name': 'Kabul Medical Supplies'},
        'needs': {'late': true},
      },
      {
        'id': 'o2',
        'refNo': 'SO-2026-0031',
        'currency': 'USD',
        'total': '12000.00',
        'due': '0.00',
        'customer': {'name': 'Herat Pharma'},
      },
    ],
  },
  '/api/money/payables': [
    {
      'factory': {'id': 'fac1', 'name': 'Shanghai Pharma Machinery'},
      'currency': 'CNY',
      'owed': '280000.00',
      'paid': '84000.00',
      'toPay': '196000.00',
      'orders': [
        {
          'id': 'o1',
          'refNo': 'SO-2026-0035',
          'customer': 'Kabul Medical Supplies',
          'word': 'In production',
          'toPay': '196000.00',
        },
      ],
    },
  ],
  '/api/money/accounts': [
    {'id': 'a1', 'name': 'HBL USD', 'kind': 'bank', 'currency': 'USD', 'balance': '52310.00'},
    {'id': 'a2', 'name': 'ICBC CNY', 'kind': 'bank', 'currency': 'CNY', 'balance': '210000.00'},
  ],
  '/api/settings': {
    'sales': {'currency': 'USD'},
  },
  '/api/orders/o1/payments': {'createdId': 'p5'},
  '/api/payments/p5/file': {'ok': true},
  '/api/submissions': {'id': 's9'},
  '/api/submissions/s9/file': {'ok': true},
  '/api/expenses': {'id': 'e3'},
  '/api/orders/o1/factory-payments': {'createdId': 'fp1'},
  '/api/factory-payments/fp1/file': {'ok': true},
  '/api/money/transfers': {'ok': true},
  '/api/notifications': {'unread': 0},
};

Future<(Session, FakeServer)> _open(
  WidgetTester t, {
  Set<String> permissions = const {'payments.record', 'expenses.manage', 'sourcing.manage'},
  PickedFile? pick,
}) async {
  KHaptics.enabled = false;
  Bell.autoRefresh = false;
  t.view.physicalSize = const Size(390 * 3, 844 * 3);
  t.view.devicePixelRatio = 3;
  addTearDown(t.view.reset);
  final (s, server) = fakeSession(_answers(), permissions: permissions);
  addTearDown(s.api.net.stop);
  final container = ProviderContainer(
    overrides: [
      sessionProvider.overrideWith((ref) => s),
      pickerProvider.overrideWithValue(_FakePicker(pick ?? PickedFile(Uint8List(2048), 'slip.jpg'))),
    ],
  );
  addTearDown(container.dispose);
  await t.pumpWidget(UncontrolledProviderScope(container: container, child: const RfqDeskApp()));
  container.read(routerProvider).go('/money');
  await t.pumpAndSettle();
  return (s, server);
}

Future<void> _inSheet(WidgetTester t, String text) async {
  await t.ensureVisible(find.text(text).last);
  await t.pumpAndSettle();
  await t.tap(find.text(text).last);
  await t.pumpAndSettle();
}

void main() {
  testWidgets('Money: what to collect, what to pay, the accounts', (t) async {
    await _open(t);
    expect(find.text('To collect: USD 19.3k'), findsOneWidget);
    expect(find.text('Kabul Medical Supplies'), findsOneWidget);
    expect(find.text('Herat Pharma'), findsNothing); // nothing due
    expect(find.text('Shanghai Pharma Machinery'), findsOneWidget);
    expect(find.text('USD 52,310.00'), findsOneWidget);
  });

  testWidgets('money received with the slip: the payment, then its file', (t) async {
    final (_, server) = await _open(t);
    await t.tap(find.text('Received'));
    await t.pumpAndSettle();
    await _inSheet(t, 'Take photo');
    expect(find.text('slip.jpg'), findsOneWidget);
    await _inSheet(t, 'Record · a receipt is made');
    final body = server.sent('POST', '/api/orders/o1/payments')!;
    expect(body['receivedAmount'], '19280.00');
    expect(body['accountId'], 'a1');
    expect(server.calls.any((c) => c.path == '/api/payments/p5/file'), isTrue);
    expect(find.text('Record · a receipt is made'), findsNothing); // the success moment played and the sheet closed
    await t.pumpAndSettle();
  });

  testWidgets('without the right to record, it goes for approval', (t) async {
    final (_, server) = await _open(t, permissions: {'money.submit'});
    await t.tap(find.text('Received'));
    await t.pumpAndSettle();
    expect(find.text('You add it; a manager approves it. It counts once approved.'), findsOneWidget);
    await _inSheet(t, 'Send for approval');
    expect(server.sent('POST', '/api/submissions')?['kind'], 'payment');
    await t.pumpAndSettle();
  });

  testWidgets('a file over the limit is refused with its size', (t) async {
    await _open(t, pick: PickedFile(Uint8List(26 * 1024 * 1024), 'scan.pdf'));
    await t.tap(find.text('Received'));
    await t.pumpAndSettle();
    await _inSheet(t, 'Choose file');
    expect(find.text('scan.pdf is 26.0 MB; the limit is 25.0 MB.'), findsOneWidget);
  });

  testWidgets('an expense needs what, for and amount; then it is added', (t) async {
    final (_, server) = await _open(t);
    await t.tap(find.text('Expense'));
    await t.pumpAndSettle();
    await _inSheet(t, 'Add expense');
    expect(find.text('Choose what it was.'), findsOneWidget);
    await _inSheet(t, 'Travel');
    await t.enterText(find.widgetWithText(KTextField, 'For'), 'Taxi to the supplier');
    await t.enterText(find.widgetWithText(KTextField, 'Amount'), '35');
    await _inSheet(t, 'Add expense');
    expect(server.sent('POST', '/api/expenses'), containsPair('category', 'travel'));
    expect(server.sent('POST', '/api/expenses'), containsPair('amount', '35'));
    await t.pumpAndSettle();
  });

  testWidgets('pay a supplier for an order, with the slip, from the right account', (t) async {
    final (_, server) = await _open(t);
    await t.scrollUntilVisible(find.text('Pay'), 300, scrollable: find.byType(Scrollable).first);
    await _inSheet(t, 'Pay');
    expect(find.textContaining('Still to pay on this order'), findsOneWidget);
    await _inSheet(t, 'Balance');
    await _inSheet(t, 'Take photo');
    await _inSheet(t, 'Record payment');
    final body = server.sent('POST', '/api/orders/o1/factory-payments')!;
    expect(body['factoryId'], 'fac1');
    expect(body['kind'], 'balance');
    expect(body['amount'], '196000.00');
    expect(body['currency'], 'CNY');
    expect(body['accountId'], 'a2');
    expect(server.calls.any((c) => c.path == '/api/factory-payments/fp1/file'), isTrue);
  });

  testWidgets('move money between accounts in two currencies asks what arrived', (t) async {
    final (_, server) = await _open(t);
    await t.scrollUntilVisible(find.text('Move money'), 300, scrollable: find.byType(Scrollable).first);
    await _inSheet(t, 'Move money');
    await _inSheet(t, 'Choose an account');
    await _inSheet(t, 'HBL USD');
    await t.tap(find.text('Choose an account'));
    await t.pumpAndSettle();
    await _inSheet(t, 'ICBC CNY');
    await t.enterText(find.widgetWithText(KTextField, 'Amount'), '10000');
    await _inSheet(t, 'Move money');
    expect(find.textContaining('How much arrived, in'), findsOneWidget); // two currencies: asks what arrived
    await t.enterText(find.widgetWithText(KTextField, 'Arrived'), '71500');
    await _inSheet(t, 'Move money');
    expect(server.sent('POST', '/api/money/transfers'), containsPair('amountIn', '71500'));
  });
}
