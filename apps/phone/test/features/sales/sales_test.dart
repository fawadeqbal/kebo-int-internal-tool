import 'package:dio/dio.dart';
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

const _id = '11111111-2222-3333-4444-555555555555';

Map<String, Object?> _answers() => {
  '/api/inquiries': {
    'total': 2,
    'page': 1,
    'pageSize': 50,
    'counts': {'new': 3, 'sourcing': 4, 'quoted': 5, 'won': 9, 'lost': 2, 'overdue': 1, 'on_hold': 0},
    'rows': [
      {
        'id': _id,
        'refNo': 'INQ-2026-0218',
        'title': 'Tablet press, 35 stations',
        'stage': 'sourcing',
        'priority': 'urgent',
        'customer': {'name': 'Kabul Medical Supplies'},
        'items': 2,
        'asked': 3,
        'offers': 1,
        'overdue': true,
      },
      {
        'id': 'x2',
        'refNo': 'INQ-2026-0215',
        'title': 'Blister line',
        'stage': 'quoted',
        'customer': {'name': 'Herat Pharma'},
      },
    ],
  },
  '/api/inquiries/$_id': {
    'id': _id,
    'refNo': 'INQ-2026-0218',
    'title': 'Tablet press, 35 stations',
    'category': 'Pharma machines',
    'stage': 'quoted',
    'priority': 'normal',
    'channel': 'whatsapp',
    'requirements': '35 stations, GMP, 380 V',
    'customer': {'name': 'Kabul Medical Supplies', 'country': 'AF'},
    'contact': {'name': 'Dr. Noori', 'phone': '+93 700 000 000'},
    'assignee': {'name': 'Bilal'},
    'items': [
      {'id': 'i1', 'no': '1', 'description': 'Rotary tablet press', 'model': 'ZP-35', 'quantity': '1', 'unit': 'set'},
    ],
    'notes': [
      {
        'body': 'Wants delivery before Ramadan',
        'createdAt': '2026-11-10T10:00:00Z',
        'author': {'name': 'Bilal'},
      },
    ],
    'createdAt': '2026-11-02T10:00:00Z',
  },
  '/api/inquiries/$_id/quotation': {
    'quotation': {'refNo': 'QT-2026-0112'},
    'revisions': [
      {
        'number': 2,
        'status': 'sent',
        'currency': 'USD',
        'total': '48200.00',
        'figuresOf': '',
        'validUntil': '2026-11-30',
        'incoterm': 'CIF',
        'incotermPlace': 'Karachi',
        'depositPercent': 30,
        'options': [
          {
            'letter': 'A',
            'discount': '0.00',
            'factory': {'name': 'Shanghai Pharma Machinery'},
            'costing': {'cost': '39600.00', 'profit': '8600.00', 'marginPercent': 17.8, 'uncostedLines': 0},
            'lines': [
              {
                'no': '1',
                'description': 'Rotary tablet press ZP-35',
                'quantity': '1',
                'unit': 'set',
                'unitPrice': '48200.00',
                'lineTotal': '48200.00',
                'unitCost': '39600.00',
              },
            ],
          },
        ],
      },
      {'number': 1, 'status': 'superseded', 'options': <Object?>[]},
    ],
  },
  '/api/follow-ups': <Object?>[],
  '/api/inquiries/$_id/stage': {'ok': true},
  '/api/inquiries/$_id/notes': {'ok': true},
  '/api/customers/names': [
    {'id': 'c1', 'name': 'Kabul Medical Supplies'},
    {'id': 'c2', 'name': 'Herat Pharma'},
  ],
  '/api/settings': {
    'sales': {
      'categories': ['Pharma machines', 'Packaging'],
    },
  },
  '/api/notifications': {'unread': 0},
};

Future<(Session, FakeServer, ProviderContainer)> _open(WidgetTester t, String at) async {
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
  return (s, server, container);
}

Finder _list(WidgetTester t) => find.byType(Scrollable).hitTestable().first;

void main() {
  testWidgets('Sales lists inquiries with stage counts; a chip filters', (t) async {
    final (_, server, _) = await _open(t, '/sales');
    expect(find.text('12 open · 4 getting prices · 1 overdue'), findsOneWidget);
    expect(find.text('Tablet press, 35 stations'), findsOneWidget);
    expect(find.text('1 of 3 offers in'), findsNothing); // part of the meta line
    expect(find.textContaining('1 of 3 offers in'), findsOneWidget);
    expect(find.text('Urgent'), findsOneWidget);
    final chip = find.widgetWithText(KChip, 'Quoted');
    final chips = find
        .descendant(
          of: find.byWidgetPredicate((w) => w is ListView && w.scrollDirection == Axis.horizontal),
          matching: find.byType(Scrollable),
        )
        .first;
    await t.scrollUntilVisible(chip, 120, scrollable: chips);
    t.widget<KChip>(chip).onPressed!(); // the strip scrolls; what matters is what the chip does
    await t.pumpAndSettle();
    await t.pumpAndSettle();
    expect(server.calls.lastWhere((c) => c.path == '/api/inquiries').queryParameters['stage'], 'quoted');
  });

  testWidgets('an inquiry shows the quotation in Internal and Customer views', (t) async {
    await _open(t, '/sales/inquiry/$_id');
    expect(find.text('Inquiry · INQ-2026-0218'), findsOneWidget);
    expect(find.text('Rotary tablet press'), findsOneWidget);
    await t.scrollUntilVisible(find.text('Margin'), 300, scrollable: _list(t));
    expect(find.text('17.8%'), findsOneWidget);
    expect(find.text('Shanghai Pharma Machinery'), findsOneWidget);
    final customerView = find.descendant(of: find.byType(KSegmented<bool>), matching: find.text('Customer'));
    await t.ensureVisible(customerView);
    await t.pumpAndSettle();
    await t.tap(customerView);
    await t.pumpAndSettle();
    expect(find.text('Margin'), findsNothing);
    expect(find.text('Shanghai Pharma Machinery'), findsNothing);
    expect(find.text('Exactly what the customer receives.'), findsOneWidget);
  });

  testWidgets('mark as lost needs a reason, then sends it', (t) async {
    final (_, server, _) = await _open(t, '/sales/inquiry/$_id');
    await t.tap(find.bySemanticsLabel('More actions'));
    await t.pumpAndSettle();
    await t.tap(find.text('Mark as lost'));
    await t.pumpAndSettle();
    await t.ensureVisible(find.text('Mark as lost').last);
    await t.pumpAndSettle();
    await t.tap(find.text('Mark as lost').last);
    await t.pumpAndSettle();
    expect(find.text('Choose why it was lost.'), findsOneWidget);
    await t.ensureVisible(find.text('They bought elsewhere'));
    await t.tap(find.text('They bought elsewhere'));
    await t.ensureVisible(find.text('Mark as lost').last);
    await t.pumpAndSettle();
    await t.tap(find.text('Mark as lost').last);
    await t.pumpAndSettle();
    expect(server.sent('POST', '/api/inquiries/$_id/stage'), {'to': 'lost', 'lostReason': 'bought_elsewhere'});
    expect(find.text('Marked as lost'), findsOneWidget);
  });

  testWidgets('a note is added', (t) async {
    final (_, server, _) = await _open(t, '/sales/inquiry/$_id');
    await t.scrollUntilVisible(find.text('Add note'), 300, scrollable: _list(t));
    await t.enterText(find.widgetWithText(KTextField, 'Add a note'), 'Called, sending the video tomorrow');
    await t.tap(find.text('Add note'));
    await t.pumpAndSettle();
    expect(server.sent('POST', '/api/inquiries/$_id/notes'), {'body': 'Called, sending the video tomorrow'});
  });

  testWidgets('a new inquiry: steps, review, save', (t) async {
    final answers = _answers();
    final (s, server, _) = await _open(t, '/sales');
    server.answers['/api/inquiries'] = (RequestOptions o) =>
        o.method == 'POST' ? {'id': _id} : answers['/api/inquiries'];
    await t.tap(find.text('Inquiry'));
    await t.pumpAndSettle();
    await t.tap(find.text('Continue'));
    await t.pumpAndSettle();
    expect(find.text('Choose the customer.'), findsOneWidget);
    await t.tap(find.text('Choose a customer'));
    await t.pumpAndSettle();
    await t.tap(find.text('Herat Pharma'));
    await t.pumpAndSettle();
    await t.tap(find.text('WhatsApp'));
    await t.tap(find.text('Continue'));
    await t.pumpAndSettle();
    await t.tap(find.text('Choose a category'));
    await t.pumpAndSettle();
    await t.tap(find.text('Packaging'));
    await t.pumpAndSettle();
    await t.enterText(find.widgetWithText(KTextField, 'Requirements'), 'Blister packing, 120 blisters a minute');
    await t.tap(find.text('Continue'));
    await t.pumpAndSettle();
    await t.tap(find.text('Review'));
    await t.pumpAndSettle();
    expect(find.text('Blister packing, 120 blisters a minute'), findsOneWidget);
    await t.tap(find.text('Save inquiry'));
    await t.pump(const Duration(milliseconds: 100));
    expect(server.sent('POST', '/api/inquiries'), {
      'customerId': 'c2',
      'channel': 'whatsapp',
      'category': 'Packaging',
      'requirements': 'Blister packing, 120 blisters a minute',
      'priority': 'normal',
      'items': <Object?>[],
    });
    await t.pumpAndSettle(
      const Duration(milliseconds: 100),
      EnginePhase.sendSemanticsUpdate,
      const Duration(seconds: 5),
    );
    expect(s.status, SessionStatus.signedIn);
  });
}
