import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kebo_app/custom/approvals.dart';
import 'package:kebo_app/custom/money.dart';
import 'package:kebo_app/ds/ds.dart';
import 'package:kebo_app/generated/screens/order.g.dart';

import '../support/harness.dart';

const _staff = {'orders.update', 'money.submit'};

Map<String, Object?> _money() => {
      'currency': 'USD',
      'total': '34639.60',
      'route': {'route': 'informal', 'summary': 'Informal, before shipment'},
      'plan': {
        'items': [
          {'id': 'p1', 'label': 'Deposit 30%', 'amount': '10391.88', 'dueOn': '2026-10-26', 'paid': '10391.88', 'open': '0.00', 'status': 'paid'},
          {'id': 'p2', 'label': 'Balance', 'amount': '24247.72', 'dueOn': '2026-11-01', 'paid': '0.00', 'open': '24247.72', 'status': 'late'},
        ],
        'next': {'label': 'Balance', 'open': '24247.72', 'dueOn': '2026-11-01', 'status': 'late'},
        'canEdit': true,
      },
      'factories': {
        'rows': [
          {'factory': {'id': 'f1', 'name': 'Henan Pack'}, 'currency': 'CNY', 'owed': '209050.00', 'paid': '0.00', 'takenOff': '0.00', 'toPay': '209050.00'},
        ],
        'plans': [
          {
            'factory': {'id': 'f1', 'name': 'Henan Pack'},
            'currency': 'CNY',
            'owed': '209050.00',
            'paid': '0.00',
            'takenOff': '0.00',
            'toPay': '209050.00',
            'rows': [
              {'label': 'Advance 30%', 'amount': '62715.00', 'dueRule': 'on_order', 'dueOn': null, 'due': '2026-10-27', 'paid': '0.00', 'open': '62715.00', 'status': 'late'},
              {'label': 'Balance 70%', 'amount': '146335.00', 'dueRule': 'on_ready', 'due': null, 'paid': '0.00', 'open': '146335.00', 'status': 'later'},
            ],
            'next': {'label': 'Advance 30%', 'open': '62715.00', 'status': 'late'},
          },
        ],
        'canRecord': true,
      },
      'cancelled': false,
    };

Map<String, Object?> _payments() => {
      'currency': 'USD',
      'total': '34639.60',
      'charged': '0.00',
      'received': '10391.88',
      'due': '24247.72',
      'credit': {'amount': '0.00', 'canUse': false},
      'payments': [
        {
          'id': 'pay1',
          'receiptNo': 1,
          'amount': '10391.88',
          'currency': 'USD',
          'receivedAmount': '10391.88',
          'receivedCurrency': 'USD',
          'paidOn': '2026-10-26',
          'method': 'bank_transfer',
          'recordedBy': {'name': 'Bilal'},
          'voided': null,
        },
      ],
    };

/// An order with a plan, a payment, a factory to pay; [waiting]: what staff sent for approval.
Map<String, Object?> moneyServer({List<Object?> waiting = const []}) => {
      '/api/orders/o1': {
        'id': 'o1',
        'refNo': 'SO-2026-0447',
        'stage': 'shipped',
        'status': 'open',
        'currency': 'USD',
        'total': '34639.60',
        'customer': {'id': 'c1', 'name': 'Lahore Pharma'},
        'documents': [],
      },
      '/api/orders/o1/steps': {'canEdit': true, 'steps': [], 'items': []},
      '/api/orders/o1/flow': {},
      '/api/orders/o1/defaults': {},
      '/api/orders/o1/papers': {
        'papers': [
          {'key': 'payment-receipt:pay1', 'kind': 'payment-receipt', 'state': 'ready', 'number': 'RC-2026-0447-1', 'label': 'Payment receipt'},
          {'key': 'payment-receipt:pay2', 'kind': 'payment-receipt', 'state': 'ready', 'number': 'RC-2026-0447-2', 'label': 'Payment receipt'},
        ],
      },
      '/api/orders/o1/files': {'files': [], 'groups': []},
      '/api/orders/o1/money': _money(),
      '/api/orders/o1/payments': _payments(),
      '/api/submissions': waiting,
      '/api/settings': {
        'sales': {'currency': 'USD', 'exchangeRates': {'CNY': 7.1}},
      },
      '/api/money/accounts': [
        {'id': 'a1', 'name': 'Bank Alfalah USD', 'currency': 'USD', 'archived': false},
        {'id': 'a2', 'name': 'ICBC CNY', 'currency': 'CNY', 'archived': false},
      ],
      '/api/customers/c1': {
        'contacts': [
          {'name': 'Ali Raza', 'isPrimary': true},
        ],
      },
    };

final moneyWaiting = [
  {
    'id': 's1',
    'kind': 'payment',
    'status': 'pending',
    'order': {'id': 'o1', 'refNo': 'SO-2026-0447', 'customer': 'Lahore Pharma'},
    'amount': '24202.72',
    'currency': 'USD',
    'submittedBy': {'id': 'u2', 'name': 'Bilal'},
    'submittedAt': '2026-11-03T09:00:00Z',
    'hasFile': true,
    'body': {'paidOn': '2026-11-03', 'method': 'bank_transfer', 'reference': 'MT103 4471'},
  },
];

Future<void> _openMoneySection(WidgetTester tester) => _scrollTo(tester, find.text('Payments received · 1'));

/// Scrolls the page (or the open form) until [f] is built and on screen.
Future<void> _scrollTo(WidgetTester tester, Finder f, {bool inSheet = false}) async {
  final list = inSheet
      ? find.descendant(of: find.descendant(of: find.byType(FormSheet), matching: find.byType(ListView)), matching: find.byType(Scrollable)).first
      : find.byType(Scrollable).first;
  await tester.scrollUntilVisible(f, 200, scrollable: list);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('the order\'s Money shows the plan, what is due, the payments and what we owe the factory', (tester) async {
    await pumpScreen(tester, const OrderScreen(id: 'o1'), moneyServer());
    await _openMoneySection(tester);
    expect(find.text('Deposit 30%'), findsOneWidget);
    expect(find.text('Paid'), findsWidgets);
    expect(find.text('Late'), findsWidgets);
    expect(find.text('Payments received · 1'), findsOneWidget);
    expect(find.textContaining('RC-2026-0447-1'), findsOneWidget);
    expect(find.text('Money received'), findsOneWidget);
    expect(find.text('Payment request'), findsOneWidget);
    await _scrollTo(tester, find.text('What we owe Henan Pack'));
    expect(find.text('Paid the factory'), findsOneWidget);
    // A tall screen, so no button is cut by the edge while checking.
    tester.view.physicalSize = const Size(1170, 9000);
    await tester.pumpAndSettle();
    await expectAccessible(tester);
  });

  testWidgets('money received starts from what is due, follows the rate and records the payment', (tester) async {
    final answers = moneyServer();
    answers['/api/orders/o1/payments'] = {..._payments(), 'createdId': 'pay2', 'payments': [..._payments()['payments']! as List, {'id': 'pay2', 'receiptNo': 2}]};
    await pumpSheet(tester, (c) => openMoneyReceived(c, orderId: 'o1', refNo: 'SO-2026-0447', customer: 'Lahore Pharma'), answers: answers);
    expect(find.text('Money received'), findsOneWidget);
    expect(find.text('24247.72'), findsOneWidget, reason: 'the amount starts from the balance due');
    expect(find.text('Record · a receipt is made'), findsOneWidget);
    expect(find.text('Rate'), findsNothing, reason: 'no rate while the money arrived in the order\'s currency');

    await tester.tap(find.text('CNY').first);
    await tester.pumpAndSettle();
    expect(find.text('Rate'), findsOneWidget);
    expect(find.text('7.100000'), findsOneWidget, reason: 'the rate starts from Settings');
    await tester.enterText(find.widgetWithText(TextField, '24247.72'), '172158.81');
    await tester.pumpAndSettle();
    await _scrollTo(tester, find.text('Left due'), inSheet: true);
    expect(find.text('USD 24,247.72'), findsNWidgets(2), reason: 'CNY 172,158.81 at 7.1 pays the balance');
    expect(find.text('USD 0.00'), findsOneWidget);

    await tester.tap(find.text('Record · a receipt is made'));
    await tester.pumpAndSettle();
    final sent = lastServer.sent('POST', '/api/orders/o1/payments')!;
    expect(sent['receivedCurrency'], 'CNY');
    expect(sent['currency'], 'USD');
    expect(sent['rate'], '7.100000');
    expect(sent['accountId'], 'a2', reason: 'the only CNY account');
    expect(find.text('Recorded · receipt RC-2026-0447-2'), findsOneWidget);
    expect(find.text('Share receipt'), findsOneWidget);
  });

  testWidgets('staff send money received for approval, not as a payment', (tester) async {
    final answers = moneyServer()..['/api/submissions'] = {'id': 's9', 'status': 'pending'};
    await pumpSheet(tester, (c) => openMoneyReceived(c, orderId: 'o1', refNo: 'SO-2026-0447'), answers: answers, permissions: _staff);
    expect(find.textContaining('a manager approves it'), findsOneWidget);
    expect(find.text('Into'), findsNothing, reason: 'staff do not choose our accounts');
    await tester.tap(find.text('Send for approval'));
    await tester.pumpAndSettle();
    expect(lastServer.sent('POST', '/api/orders/o1/payments'), isNull);
    final sent = lastServer.sent('POST', '/api/submissions')!;
    expect(sent['kind'], 'payment');
    expect(sent['orderId'], 'o1');
    expect((sent['body'] as Map)['receivedAmount'], '24247.72');
    expect(find.text('Sent for approval · a manager is told'), findsOneWidget);
  });

  testWidgets('an expense: the kind fills what it was for, own money goes to be repaid, staff send it for approval', (tester) async {
    final answers = moneyServer()..['/api/submissions'] = {'id': 's10', 'status': 'pending'};
    await pumpSheet(tester, (c) => openExpense(c, orderId: 'o1', refNo: 'SO-2026-0447'), answers: answers, permissions: _staff);
    expect(find.text('More…'), findsOneWidget, reason: 'seven kinds as chips, the rest in a list');
    await tester.enterText(find.byType(TextField).first, '320');
    await tester.tap(find.text('Inland transport'));
    await tester.pumpAndSettle();
    await _scrollTo(tester, find.text('What for'), inSheet: true);
    expect(find.widgetWithText(TextField, 'Inland transport'), findsOneWidget, reason: 'what for starts from the kind');
    await _scrollTo(tester, find.text('I paid it from my own money (to be repaid)'), inSheet: true);
    await tester.tap(find.text('I paid it from my own money (to be repaid)'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Send for approval'));
    await tester.pumpAndSettle();
    final sent = lastServer.sent('POST', '/api/submissions')!;
    expect(sent['kind'], 'expense');
    final body = sent['body'] as Map;
    expect(body['category'], 'inland_transport');
    expect(body['amount'], '320');
    expect(body['ownMoney'], true);
    expect(body['paidById'], 'me');
    expect(body['orderId'], 'o1');
    await expectAccessible(tester);
  });

  testWidgets('money waiting for a manager shows on the order; the manager approves it there', (tester) async {
    final answers = moneyServer(waiting: moneyWaiting)..['/api/submissions/s1/approve'] = {'createdId': 'pay3'};
    await pumpScreen(tester, const OrderScreen(id: 'o1'), answers);
    await _scrollTo(tester, find.text('Waiting for a manager · 1'));
    await _scrollTo(tester, find.text('Money received · USD 24,202.72'));
    expect(find.text('Waiting'), findsOneWidget);
    await tester.tap(find.text('Money received · USD 24,202.72'));
    await tester.pumpAndSettle();
    expect(find.text('MT103 4471'), findsOneWidget);
    expect(find.text('See the bank slip'), findsOneWidget);
    await tester.tap(find.text('Approve'));
    await tester.pumpAndSettle();
    expect(lastServer.calls.any((c) => c.method == 'POST' && c.path == '/api/submissions/s1/approve'), isTrue);
  });

  testWidgets('the approvals list: a manager sends one back with a reason', (tester) async {
    final answers = {'/api/submissions': moneyWaiting, '/api/submissions/s1/send-back': {'ok': true}};
    await pumpScreen(tester, const ApprovalsScreen(), answers);
    expect(find.text('To approve 1'), findsNothing, reason: 'counts come from the server; none here');
    expect(find.text('Money received · USD 24,202.72'), findsOneWidget);
    await expectAccessible(tester);
    await tester.tap(find.text('Money received · USD 24,202.72'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Send back…'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Wrong amount'));
    await tester.tap(find.widgetWithText(FilledButton, 'Send it back'));
    await tester.pumpAndSettle();
    expect(lastServer.sent('POST', '/api/submissions/s1/send-back'), {'reason': 'Wrong amount'});
  });

  testWidgets('a receipt is shared with a ready message to the customer\'s contact', (tester) async {
    await pumpScreen(tester, const OrderScreen(id: 'o1'), moneyServer());
    await _openMoneySection(tester);
    await tester.tap(find.textContaining('RC-2026-0447-1'));
    await tester.pumpAndSettle();
    expect(find.text('Share · payment receipt'), findsOneWidget);
    expect(find.textContaining('Dear Ali Raza'), findsOneWidget);
    expect(find.textContaining('Thank you for your payment of USD 10,391.88'), findsOneWidget);
    expect(find.text('WhatsApp'), findsOneWidget);
    expect(find.text('Copy the message'), findsOneWidget);
  });
}
