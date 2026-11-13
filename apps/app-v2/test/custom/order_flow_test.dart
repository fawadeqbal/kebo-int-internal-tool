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
      '/api/orders/o1/sections': {
        'stages': ['payment', 'shipping', 'delivery'],
        'stands': [
          {'stage': 'payment', 'label': 'Payment', 'word': 'Deposit in', 'tone': 'ok', 'fact': 'Bank transfer (T/T) · 30% USD 9,196.36 in on 2 Nov', 'missing': ''},
          {'stage': 'shipping', 'label': 'Shipping', 'word': 'Booked', 'tone': 'info', 'fact': 'Sino Trans · NGB-77812', 'missing': 'container, B/L empty'},
          {'stage': 'delivery', 'label': 'Delivery & SAT', 'word': 'Not yet', 'tone': 'neutral', 'fact': 'Not delivered yet', 'missing': ''},
        ],
        'production': [],
      },
      '/api/orders/o1/flow': <String, Object?>{},
      '/api/orders/o1/defaults': <String, Object?>{},
      '/api/orders/o1/papers': {'papers': []},
      '/api/orders/o1/files': {'files': [], 'groups': []},
    };

void main() {
  testWidgets('the order shows where each stage stands: its word and a line of facts, nothing to tick', (tester) async {
    await pumpScreen(tester, const OrderScreen(id: 'o1'), _server());
    expect(find.text('Where it stands'), findsWidgets);
    expect(find.text('Payment'), findsOneWidget);
    expect(find.text('Deposit in'), findsOneWidget);
    expect(find.text('Booked'), findsOneWidget);
    expect(find.textContaining('Sino Trans · NGB-77812'), findsOneWidget);
    expect(find.textContaining('container, B/L empty'), findsOneWidget);
    expect(find.text('Fill it'), findsNothing);
    await expectAccessible(tester);
  });

  testWidgets('Delivery & SAT opens its screen, which says when the company does not use it', (tester) async {
    await pumpScreen(tester, const OrderScreen(id: 'o1'), _server());
    await tester.tap(find.text('Delivery & SAT'));
    await tester.pumpAndSettle();
    expect(find.text('Delivery & SAT is switched off'), findsOneWidget);
  });
}
