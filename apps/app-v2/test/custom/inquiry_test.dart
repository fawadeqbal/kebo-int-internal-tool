import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kebo_app/generated/screens/inquiry.g.dart';

import '../support/harness.dart';

Map<String, Object?> _server({String stage = 'quoted'}) => {
      '/api/inquiries/i1': {
        'id': 'i1',
        'refNo': 'RFQ-2026-0004',
        'title': 'PVC pipe 110mm, 6m',
        'stage': stage,
        'onHold': false,
        'assigneeId': 'u1',
        'assignee': {'id': 'u1', 'name': 'Sana'},
        'customerId': 'c1',
        'customer': {'id': 'c1', 'name': 'Karachi Builders', 'country': 'PK', 'contacts': []},
        'category': 'Building materials',
        'quotation': {'refNo': 'QUO-2026-0001', 'latest': {'number': 1, 'status': 'sent', 'currency': 'USD', 'total': '9008.00'}},
        'items': [
          {'id': 'it1', 'no': '1', 'description': 'PVC pipe 110mm, 6m', 'quantity': '800', 'unit': 'pcs'},
        ],
        'notes': [
          {'id': 'n1', 'body': 'They compare with a Turkish offer', 'authorId': 'u1', 'createdAt': '2026-11-03T10:12:00.000Z'},
        ],
        'attachments': [],
        'stageChanges': [],
      },
      '/api/inquiries/i1/notes': [
        {
          'id': 'n1',
          'kind': 'call',
          'body': 'They compare with a Turkish offer',
          'at': '2026-11-03T10:12:00.000Z',
          'author': {'id': 'u1', 'name': 'Sana'},
          'contact': null,
          'can': {'edit': true, 'delete': true},
        },
      ],
      '/api/follow-ups': {'rows': <Object>[]},
      '/api/inquiries/i1/quotation': {
        'revisions': [
          {
            'id': 'r1',
            'number': 1,
            'status': 'sent',
            'currency': 'USD',
            'incoterm': 'FOB',
            'depositPercent': 30,
            'sentOn': '2026-10-30',
            'validUntil': '2026-11-15',
            'total': '9008.00',
            'canAnswer': true,
            'options': [
              {'id': 'o1', 'letter': 'A', 'factory': {'name': 'Qingdao Packaging'}, 'total': '9008.00', 'coverage': {'missing': []}},
            ],
          },
        ],
      },
      '/api/inquiries/i1/sourcing': {
        'currency': 'USD',
        'missingRates': [],
        'quotes': [
          {'id': 'q1', 'factory': {'name': 'Qingdao Packaging'}, 'currency': 'CNY', 'taxRate': 13, 'totalCost': '7384.00', 'coverage': {'missing': []}},
        ],
      },
      '/api/users/people': [
        {'id': 'u1', 'name': 'Sana'},
      ],
      '/api/revisions/r1/status': {'ok': true},
      '/api/inquiries/i1/stage': {'ok': true},
    };

void main() {
  testWidgets('a quoted inquiry shows the next step, prices, quotation and notes', (tester) async {
    await pumpScreen(tester, const InquiryScreen(id: 'i1'), _server());
    expect(find.text('Next: follow up the quotation'), findsOneWidget);
    expect(find.text('Accepted'), findsOneWidget);
    for (final t in ['Factory prices · 1', 'Quotation · QUO-2026-0001', 'Notes · 1']) {
      await tester.scrollUntilVisible(find.text(t), 200, scrollable: find.byType(Scrollable).first);
      expect(find.text(t), findsOneWidget);
    }
    expect(find.text('They compare with a Turkish offer'), findsOneWidget);
    await expectAccessible(tester);
  });

  testWidgets('Accepted sends the option and the day, and says it makes the order', (tester) async {
    await pumpScreen(tester, const InquiryScreen(id: 'i1'), _server());
    await tester.tap(find.text('Accepted'));
    await tester.pumpAndSettle();
    expect(find.textContaining('This makes the order from Option A'), findsOneWidget);
    await tester.tap(find.text('Make the order'));
    await tester.pumpAndSettle();
    final body = lastServer.sent('POST', '/api/revisions/r1/status')!;
    expect(body['to'], 'accepted');
    expect(body['optionId'], 'o1');
    expect(body['on'], isA<String>());
  });

  testWidgets('Mark as lost asks why and sends it', (tester) async {
    await pumpScreen(tester, const InquiryScreen(id: 'i1'), _server(stage: 'sourcing'));
    await tester.tap(find.byTooltip('More actions'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Mark as lost'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Mark as lost'));
    await tester.pumpAndSettle();
    expect(find.text('Why is needed'), findsOneWidget, reason: 'the reason is required');
    await tester.tap(find.text('Price too high'));
    await tester.tap(find.widgetWithText(FilledButton, 'Mark as lost'));
    await tester.pumpAndSettle();
    expect(lastServer.sent('POST', '/api/inquiries/i1/stage'), {'to': 'lost', 'lostReason': 'price_too_high'});
  });
}
