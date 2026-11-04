import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kebo_app/generated/screens/order.g.dart';

import '../support/harness.dart';

Map<String, Object?> _server() => {
      '/api/orders/o1': {
        'id': 'o1',
        'refNo': 'SO-2026-0127',
        'stage': 'shipped',
        'status': 'open',
        'currency': 'USD',
        'total': '30654.52',
        'customer': {'id': 'c1', 'name': 'Lahore Pharma'},
        'inquiry': {'refNo': 'RFQ-2026-0161', 'title': 'Blister packing machine', 'assignee': {'name': 'Sana'}},
        'documents': [],
      },
      '/api/orders/o1/steps': {
        'canEdit': true,
        'steps': [
          {'key': 'payment', 'number': 1, 'label': 'Payment', 'state': 'done', 'stateLabel': 'Done', 'done': 3, 'total': 3},
          {'key': 'shipping', 'number': 4, 'label': 'Shipping', 'state': 'now', 'stateLabel': 'Now', 'done': 3, 'total': 5, 'line': 'Sea to Karachi · Sino Trans'},
        ],
        'doNow': {'step': 'shipping', 'label': 'Shipping', 'key': 'sailed', 'title': 'Sailed · bill of lading', 'needs': 'vessel, B/L number, sailed on', 'dueOn': '2026-11-20', 'late': false},
        'items': [
          {'key': 'booked', 'step': 'shipping', 'title': 'Space booked', 'done': true, 'data': [['Forwarder', 'Sino Trans']]},
          {'key': 'sailed', 'step': 'shipping', 'title': 'Sailed · bill of lading', 'done': false, 'needs': 'vessel, B/L number, sailed on'},
          {'key': 'claims_closed', 'step': 'shipping', 'title': 'Claims closed', 'done': false},
        ],
      },
      '/api/orders/o1/flow': {
        'shipping': {
          'shipments': [
            {'id': 's1', 'vessel': 'MSC Aurora', 'blNo': null},
          ],
        },
      },
      '/api/orders/o1/defaults': {},
      '/api/orders/o1/papers': {'papers': []},
      '/api/orders/o1/files': {'files': [], 'groups': []},
      '/api/shipments/s1': {'ok': true},
    };

void main() {
  testWidgets('the order shows what to do now, the step chips and the step\'s checklist', (tester) async {
    await pumpScreen(tester, const OrderScreen(id: 'o1'), _server());
    expect(find.text('DO NOW · SHIPPING'), findsOneWidget);
    expect(find.text('Fill it'), findsOneWidget);
    expect(find.text('✓ Payment 3/3'), findsOneWidget);
    expect(find.text('Shipping · 3 of 5'), findsOneWidget);
    expect(find.text('Space booked'), findsOneWidget);
    await expectAccessible(tester);
  });

  testWidgets('Fill it asks only what the item needs and saves it on the shipment', (tester) async {
    await pumpScreen(tester, const OrderScreen(id: 'o1'), _server());
    await tester.tap(find.text('Fill it'));
    await tester.pumpAndSettle();
    expect(find.text('MSC Aurora'), findsOneWidget, reason: 'the vessel starts from the shipment');
    await tester.tap(find.text('Tick it'));
    await tester.pumpAndSettle();
    expect(find.text('B/L number is needed'), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, '').first, 'MSC Aurora');
    final bl = find.byType(TextField).at(1);
    await tester.enterText(bl, 'cosu6281734510');
    await tester.tap(find.text('Tick it'));
    await tester.pumpAndSettle();
    final sent = lastServer.sent('PATCH', '/api/shipments/s1')!;
    expect(sent['status'], 'departed');
    expect(sent['blNo'], 'COSU6281734510');
    expect(sent['departedOn'], isA<String>());
  });

  testWidgets('an item done on the web says so', (tester) async {
    await pumpScreen(tester, const OrderScreen(id: 'o1'), _server());
    await tester.tap(find.text('Claims closed'));
    await tester.pumpAndSettle();
    expect(find.text('Claims are closed on the web.'), findsOneWidget);
    expect(find.text('Open on the web'), findsOneWidget);
  });
}
