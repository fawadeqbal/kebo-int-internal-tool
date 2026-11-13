import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kebo_app/custom/delivery.dart';
import 'package:kebo_app/custom/factory_visit.dart';
import 'package:kebo_app/custom/paper_make.dart';
import 'package:kebo_app/generated/models.g.dart';
import 'package:kebo_app/generated/screens/customer.g.dart';
import 'package:kebo_app/generated/screens/factory.g.dart';

import '../support/harness.dart';

/// An order delivered to the customer (Karachi Bottlers).
final phase5Order = Order.fromJson({
  'id': 'o1',
  'refNo': 'SO-2026-0402',
  'status': 'open',
  'stage': 'shipped',
  'currency': 'USD',
  'customer': {'id': 'c1', 'name': 'Karachi Bottlers'},
});

/// An order at the customer's site: two goods lines, nothing checked yet.
Map<String, Object?> deliveryServer() => {
      '/api/orders/o1': {
        'id': 'o1',
        'lines': [
          {'id': 'l1', 'no': '1', 'type': 'goods', 'description': 'Filler RFC-32', 'quantity': '1', 'unit': 'set', 'delivered': {'qty': '0', 'condition': null, 'note': null}},
          {'id': 'l2', 'no': '2', 'type': 'goods', 'description': 'Conveyor 12 m', 'quantity': '1', 'unit': 'set', 'delivered': {'qty': '1', 'condition': 'damaged', 'note': 'guard door dented'}},
          {'id': 'l3', 'no': '3', 'type': 'charge', 'description': 'Sea freight', 'quantity': '1'},
        ],
      },
      '/api/orders/o1/flow': {
        'shipping': {
          'shipments': [
            {'id': 's1', 'arrivedOn': '2026-10-18'},
          ],
        },
        'delivery': {
          'deliveredOn': null,
          'condition': null,
          'receivedBy': null,
          'satEngineer': null,
          'sat': [],
          'suggestedSat': ['Machine and parts match the packing list', 'No transport damage', 'Test run at rated speed'],
          'claims': [
            {'id': 'k1', 'title': 'Dented guard door', 'detail': 'with the factory', 'status': 'open', 'openedOn': '2026-10-18'},
          ],
        },
      },
      '/api/orders/o1/delivery/all-good': {'ok': true},
      '/api/order-lines/l1': {
        'line': {'id': 'l1', 'delivered': {'qty': '1', 'condition': 'damaged', 'note': 'scratched panel'}},
      },
      '/api/orders/o1/claims': {'ok': true},
      '/api/orders/o1/sat': {'ok': true},
    };

/// Two factories on the order and the factory test not done.
Map<String, Object?> visitServer() => {
      '/api/orders/o1/flow': {
        'factory': {
          'readyBy': [
            {'factoryId': 'f1', 'name': 'Wenzhou Pack', 'readyOn': '2026-11-20'},
            {'factoryId': 'f2', 'name': 'Henan Pack', 'readyOn': null},
          ],
          'factories': [
            {'id': 'f1', 'name': 'Wenzhou Pack'},
            {'id': 'f2', 'name': 'Henan Pack'},
          ],
        },
      },
      '/api/orders/o1/sections': {
        'stands': [],
        'production': [
          {'factory': {'id': 'f1', 'name': 'Wenzhou Pack'}, 'readyOn': '2026-11-20', 'fat': {'plannedOn': null, 'doneOn': null, 'result': null, 'remarks': null}},
          {'factory': {'id': 'f2', 'name': 'Henan Pack'}, 'readyOn': null, 'fat': {'plannedOn': null, 'doneOn': null, 'result': null, 'remarks': null}},
        ],
      },
      '/api/orders/o1/factory-facts': {'ok': true},
    };

Map<String, Object?> _checks(bool ready) => {
          'refNo': 'SO-2026-0402',
          'number': 'CI-2026-0402',
          'madeFrom': 'order lines + B/L no., vessel, ports',
          'ready': ready,
          'paper': null,
          'checks': [
            {'key': 'buyer', 'label': 'Buyer and address', 'value': 'Karachi Bottlers', 'ok': true, 'required': true},
            {'key': 'vessel', 'label': 'Vessel and ports', 'value': ready ? 'MSC Aurora' : 'Ningbo', 'ok': ready, 'required': true, 'fix': ready ? null : 'vessel'},
          ],
          'fixes': {
            'vessel': {'label': 'Vessel', 'type': 'text', 'saves': 'the shipment'},
          },
          'options': [
            {'key': 'prices', 'label': 'Line amounts', 'on': true},
            {'key': 'stamp', 'label': 'Stamp and signature', 'on': true},
          ],
        };
/// A commercial invoice missing the vessel, then ready once it is typed.
Map<String, Object?> paperServer() => {
      '/api/orders/o1/papers/commercial-invoice/checks': _checks(false),
      '/api/orders/o1/papers/commercial-invoice/fix': _checks(true),
      '/api/orders/o1/papers/commercial-invoice': {
        'paper': {'id': 'p1', 'status': 'draft'},
      },
      '/api/papers/p1/final': {
        'paper': {'id': 'p1', 'status': 'final', 'number': 'CI-2026-0402'},
      },
    };

/// A customer with figures, credit and one change.
Map<String, Object?> customerServer() => {
        '/api/customers/c1': {
          'id': 'c1',
          'name': 'Lahore Pharma',
          'country': 'PK',
          'contacts': [
            {'id': 'k1', 'name': 'Ali Raza', 'phone': '+92 300 1234567', 'isPrimary': true},
          ],
          'orders': [
            {'id': 'o1', 'refNo': 'SO-2026-0447', 'status': 'open', 'total': '34639.60', 'currency': 'USD', 'orderedOn': '2026-10-20'},
          ],
          'inquiries': [],
        },
        '/api/insights/facts/orders/groups': {
          'currency': 'USD',
          'seeMoney': true,
          'rows': [
            {'orders': 5, 'sales': '112400.00', 'margin': 14, 'due': '44100.00', 'overdue': '18200.00', 'paid': {'inFull': 4, 'onTime': 3, 'percent': 75}, 'lastOrderedOn': '2026-10-20'},
          ],
        },
        '/api/customers/c1/credit': {
          'balances': [
            {'currency': 'USD', 'amount': '500.00'},
          ],
        },
        '/api/history': [
          {'id': 'h1', 'at': '2026-11-03T09:00:00Z', 'by': {'name': 'Sana'}, 'summary': 'Added customer Lahore Pharma (PK)'},
        ],
      };

/// A factory with an offer, answer stats, an open order and money we owe.
Map<String, Object?> factoryServer() => {
      '/api/factories/f1': {
        'id': 'f1',
        'name': 'Henan Pack',
        'contactPerson': 'Mr Chen',
        'phone': '+86 138 0000 0000',
        'wechat': 'chen_henan',
        'owner': {'id': 'u1', 'name': 'Bilal'},
        'quotes': [
          {'id': 'q1', 'receivedOn': '2026-10-29T00:00:00.000Z', 'currency': 'CNY', 'inquiry': {'id': 'i1', 'refNo': 'RFQ-2026-0645', 'title': 'Bottling line'}},
        ],
        'record': {
          'asked': 6,
          'answered': 5,
          'declined': 0,
          'noReply': 1,
          'avgDaysToAnswer': 2.5,
          'lateSteps': 0,
          'openOrders': [
            {'id': 'o1', 'refNo': 'SO-2026-0447', 'customer': 'Lahore Pharma', 'readyOn': '2026-11-20'},
          ],
        },
      },
      '/api/money/payables': [
        {'factory': {'id': 'f1', 'name': 'Henan Pack'}, 'currency': 'CNY', 'owed': '209050.00', 'paid': '62715.00', 'toPay': '146335.00'},
      ],
      '/api/history': <Object?>[],
    };

Future<void> _tall(WidgetTester tester) async {
  tester.view.physicalSize = const Size(1170, 6000);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('Delivery & SAT: what arrived, problems first, SAT and claims', (tester) async {
    await pumpScreen(tester, Builder(builder: (c) => Scaffold(body: Center(child: FilledButton(onPressed: () => openDelivery(c, phase5Order), child: const Text('Go'))))), deliveryServer());
    await tester.tap(find.text('Go'));
    await tester.pumpAndSettle();
    expect(find.text('Delivery & SAT'), findsOneWidget);
    expect(find.text('Karachi Bottlers · arrived 18 Oct'), findsOneWidget);
    expect(find.text('Every line arrived in full and in good condition'), findsOneWidget);
    expect(find.text('2 · Conveyor 12 m'), findsOneWidget, reason: 'a line with a problem comes first');
    expect(find.text('Damaged'), findsOneWidget);
    expect(find.text('Not checked'), findsOneWidget);
    expect(find.text('Sea freight'), findsNothing, reason: 'charges are not delivered');
    expect(find.text('Confirm delivery'), findsOneWidget);
    await _tall(tester);
    expect(find.text('Dented guard door'), findsOneWidget);
    await expectAccessible(tester);

    await tester.tap(find.text('Every line arrived in full and in good condition'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Confirm delivery').last);
    await tester.pumpAndSettle();
    expect(lastServer.sent('POST', '/api/orders/o1/delivery/all-good')?['deliveredOn'], isNotNull);
  });

  testWidgets('a damaged line: condition, note and a claim named after the line', (tester) async {
    await pumpScreen(tester, Builder(builder: (c) => Scaffold(body: Center(child: FilledButton(onPressed: () => openDelivery(c, phase5Order), child: const Text('Go'))))), deliveryServer());
    await tester.tap(find.text('Go'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('1 · Filler RFC-32'));
    await tester.pumpAndSettle();
    expect(find.text('Line 1 · Filler RFC-32'), findsOneWidget);
    await tester.tap(find.widgetWithText(ChoiceChip, 'Damaged'));
    await tester.enterText(find.byType(TextField).at(1), 'scratched panel');
    await tester.tap(find.text('Open a claim for it'));
    await tester.pumpAndSettle();
    expect(find.widgetWithText(TextField, 'Line 1 · Filler RFC-32 damaged'), findsOneWidget);
    await expectAccessible(tester);
    await tester.tap(find.text('Save the line'));
    await tester.pumpAndSettle();
    final line = lastServer.sent('PATCH', '/api/order-lines/l1')!;
    expect(line['set'], 'delivered');
    expect(line['condition'], 'damaged');
    expect(line['deliveredQty'], 1);
    expect(line['note'], 'scratched panel');
    expect(lastServer.sent('POST', '/api/orders/o1/claims')?['title'], 'Line 1 · Filler RFC-32 damaged');
  });

  testWidgets('SAT checks start from the usual list and are saved whole', (tester) async {
    await pumpScreen(tester, Builder(builder: (c) => Scaffold(body: Center(child: FilledButton(onPressed: () => openDelivery(c, phase5Order), child: const Text('Go'))))), deliveryServer());
    await tester.tap(find.text('Go'));
    await tester.pumpAndSettle();
    await _tall(tester);
    await tester.tap(find.text('Add the checks'));
    await tester.pumpAndSettle();
    expect(find.widgetWithText(TextField, 'No transport damage'), findsOneWidget);
    await tester.tap(find.text('Save the checks'));
    await tester.pumpAndSettle();
    final checks = lastServer.sent('PUT', '/api/orders/o1/sat')!['checks'] as List;
    expect(checks, hasLength(3));
    expect((checks.first as Map)['result'], 'pending');
  });

  testWidgets('factory visit: the factory test\'s result is kept on Production; the ready date is left alone when not changed', (tester) async {
    final answers = visitServer();
    await pumpSheet(tester, (c) => openFactoryVisit(c, phase5Order), answers: answers, permissions: const {'orders.update'});
    expect(find.text('Factory visit'), findsOneWidget);
    expect(find.text('Wenzhou Pack'), findsOneWidget);
    expect(find.text('20 Nov 2026'), findsOneWidget);
    expect(find.text('Visit expense (taxi, hotel…)'), findsNothing, reason: 'no right to add expenses');
    await tester.tap(find.text('Passed with remarks'));
    await tester.enterText(find.byType(TextField).first, 'Speed 98 bpm at test');
    await tester.pumpAndSettle();
    await expectAccessible(tester);
    await tester.tap(find.text('Save the visit'));
    await tester.pumpAndSettle();
    expect(lastServer.sent('PATCH', '/api/orders/o1/details'), isNull);
    final test = lastServer.sent('PUT', '/api/orders/o1/factory-facts')!;
    expect(test['factoryId'], 'f1');
    expect(test['fatResult'], 'passed_with_remarks');
    expect(test['fatDoneOn'], isA<String>());
    expect(test['fatRemarks'], 'Speed 98 bpm at test');
  });

  testWidgets('making a paper: what is missing is typed in place, then it is made final', (tester) async {
    final answers = paperServer();
    await pumpSheet(tester, (c) => openMakePaper(c, orderId: 'o1', kind: 'commercial-invoice', label: 'Commercial invoice'), answers: answers);
    expect(find.text('Make · Commercial invoice'), findsOneWidget);
    expect(find.text('Fill what is missing first'), findsOneWidget);
    await expectAccessible(tester);
    await tester.enterText(find.widgetWithText(TextField, 'Vessel'), 'MSC Aurora');
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();
    expect(lastServer.sent('POST', '/api/orders/o1/papers/commercial-invoice/fix'), {'field': 'vessel', 'value': 'MSC Aurora'});
    await tester.tap(find.text('Make it final'));
    await tester.pumpAndSettle();
    expect((lastServer.sent('POST', '/api/orders/o1/papers/commercial-invoice')!['options'] as Map)['stamp'], true);
    expect(lastServer.calls.any((c) => c.method == 'POST' && c.path == '/api/papers/p1/final'), isTrue);
    expect(find.text('Made · Commercial invoice · CI-2026-0402'), findsOneWidget);
    expect(find.text('Share'), findsOneWidget);
  });


  testWidgets('a customer: how they do, credit held, orders that open, changes, New inquiry', (tester) async {
    await pumpScreen(tester, const CustomerScreen(id: 'c1'), customerServer());
    expect(find.text('New inquiry'), findsOneWidget);
    expect(find.text('USD 112.4k'), findsOneWidget);
    expect(find.text('USD 18.2k overdue'), findsOneWidget);
    expect(find.text('USD 500.00'), findsOneWidget);
    await _tall(tester);
    expect(find.text('Added customer Lahore Pharma (PK)'), findsOneWidget);
    await expectAccessible(tester);
    await tester.tap(find.text('SO-2026-0447'));
    await tester.pumpAndSettle();
    expect(find.text('Opened /orders/o1'), findsOneWidget);
  });

  testWidgets('a customer without reports sees no figures, only the credit', (tester) async {
    await pumpScreen(tester, const CustomerScreen(id: 'c1'), customerServer(), permissions: const {'customers.manage'});
    expect(find.text('Sales'), findsNothing);
    expect(find.text('USD 500.00'), findsOneWidget);
    expect(find.text('New inquiry'), findsNothing, reason: 'no right to add inquiries');
  });

  testWidgets('a factory: call, WeChat id, how they answer, what we owe, offers that open the inquiry', (tester) async {
    await pumpScreen(tester, const FactoryScreen(id: 'f1'), factoryServer());
    expect(find.text('Mr Chen'), findsOneWidget);
    expect(find.text('Copy WeChat id'), findsOneWidget);
    expect(find.text('1 never answered'), findsOneWidget);
    expect(find.text('CNY 146,335.00'), findsOneWidget);
    await _tall(tester);
    await expectAccessible(tester);
    await tester.tap(find.text('Bottling line'));
    await tester.pumpAndSettle();
    expect(find.text('Opened /inquiries/i1'), findsOneWidget);
  });
}
