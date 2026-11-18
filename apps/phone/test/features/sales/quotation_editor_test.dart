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
    'stage': 'quoted',
    'items': <Object?>[],
  },
  '/api/inquiries/$_id/quotation': {
    'quotation': {'refNo': 'QT-2026-0112'},
    'canStartRevision': true,
    'revisions': [
      {
        'id': 'rev2',
        'number': 2,
        'status': 'sent',
        'currency': 'USD',
        'total': '48200.00',
        'figuresOf': '',
        'validUntil': '2026-11-30',
        'options': [
          {'id': 'optA', 'letter': 'A', 'discount': '0.00', 'total': '48200.00', 'lines': <Object?>[]},
        ],
      },
    ],
  },
  '/api/follow-ups': <Object?>[],
  '/api/revisions/rev2/status': {'ok': true},
  '/api/inquiries/$_id/quotation/draft': {
    'number': 3,
    'currency': 'USD',
    'incoterm': 'CIF',
    'incotermPlace': 'Karachi',
    'depositPercent': 30,
    'validUntil': '2026-12-15',
    'paymentTerms': '30% deposit',
    'options': [
      {
        'factoryQuoteId': 'q1',
        'discount': 0,
        'charges': <Object?>[],
        'costs': <Object?>[],
        'prices': [
          {'lineId': 'l1', 'unitPrice': '45000.00'},
        ],
      },
    ],
  },
  '/api/inquiries/$_id/quotation/offers': {
    'offers': [
      {
        'factoryQuoteId': 'q1',
        'factory': {'name': 'Shanghai Pharma Machinery'},
        'lines': [
          {
            'id': 'l1',
            'no': '1',
            'description': 'Rotary tablet press',
            'quantity': '1',
            'unit': 'set',
            'unitCost': '39600.00',
          },
        ],
      },
    ],
  },
  '/api/inquiries/$_id/quotation/revisions': {'id': 'rev3'},
  '/api/notifications': {'unread': 0},
};

Future<FakeServer> _open(WidgetTester t, String at) async {
  KHaptics.enabled = false;
  Bell.autoRefresh = false;
  t.view.physicalSize = const Size(390 * 3, 844 * 3);
  t.view.devicePixelRatio = 3;
  addTearDown(t.view.reset);
  final (s, server) = fakeSession(_answers(), permissions: {'quotations.manage', 'sourcing.manage'});
  addTearDown(s.api.net.stop);
  final container = ProviderContainer(overrides: [sessionProvider.overrideWith((ref) => s)]);
  addTearDown(container.dispose);
  await t.pumpWidget(UncontrolledProviderScope(container: container, child: const RfqDeskApp()));
  container.read(routerProvider).go(at);
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
  testWidgets('a new revision: cost and margin per line, a margin for all, saved as a draft', (t) async {
    final server = await _open(t, '/sales/inquiry/$_id/quote');
    await t.scrollUntilVisible(find.textContaining('cost USD 39,600.00 (Internal)'), 300, scrollable: find.byType(Scrollable).hitTestable().first);
    expect(find.textContaining('1 set · cost USD 39,600.00 (Internal) · margin 12.0%'), findsOneWidget);
    await t.enterText(find.widgetWithText(KTextField, 'Margin for every item'), '20');
    await _tap(t, 'Apply');
    expect(find.textContaining('(Internal) · margin 20.0%'), findsOneWidget);
    await _tap(t, 'Save as draft');
    final body = server.sent('POST', '/api/inquiries/$_id/quotation/revisions')!;
    expect(body.containsKey('number'), isFalse);
    expect((((body['options'] as List).single as Map)['prices'] as List).single, {
      'lineId': 'l1',
      'unitPrice': '49500.00',
    });
    expect(body['paymentTerms'], '30% deposit');
  });

  testWidgets('the customer accepted: the order is made, with a moment', (t) async {
    final server = await _open(t, '/sales/inquiry/$_id');
    await t.scrollUntilVisible(find.text('Accepted'), 300, scrollable: find.byType(Scrollable).hitTestable().first);
    await _tap(t, 'Accepted');
    await t.enterText(find.widgetWithText(KTextField, 'Their PO or reference'), 'PO-7781');
    await _tap(t, 'Accepted · make the order');
    expect(server.sent('POST', '/api/revisions/rev2/status'), {
      'to': 'accepted',
      'optionId': 'optA',
      'customerRef': 'PO-7781',
    });
    expect(find.text('Deal won. The order is made.'), findsOneWidget);
    await t.pumpAndSettle();
  });
}
