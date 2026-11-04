import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kebo_app/custom/alerts.dart';
import 'package:kebo_app/custom/home.dart';
import 'package:kebo_app/custom/links.dart';
import 'package:kebo_app/custom/search.dart';
import 'package:kebo_app/ds/ds.dart';

import '../support/harness.dart';

final _now = DateTime.now().toUtc().toIso8601String();

final homeServer = <String, Object?>{
  '/api/reminders': {
    'items': [
      {'key': 'a', 'kind': 'money', 'level': 'bad', 'title': 'SO-2026-0043: Get the balance (USD 33,140.01)', 'detail': 'Harbour Pharma · 58 days late', 'href': '/orders/5e258e2e-7869-4225-a99e-4ad5cf0afc68'},
      {'key': 'b', 'kind': 'deal', 'level': 'warn', 'title': 'RFQ-2026-0645: quote expires Friday', 'detail': 'Lagos Water', 'href': '/inquiries/1'},
    ],
    'counts': {'total': 2, 'bad': 1},
  },
  '/api/dashboard': {
    'money': {
      'currency': 'USD',
      'thisMonth': {'quoted': '2893591.12', 'won': '1692475.64', 'received': '163614.47'},
      'now': {'toReceive': '2474303.96', 'openOrders': 152},
    },
  },
  '/api/me/target': {'target': null},
  '/api/notifications': {
    'unread': 1,
    'total': 2,
    'items': [
      {'id': 'n1', 'type': 'payment.late', 'title': 'Balance late', 'body': 'SO-2026-0447 · USD 24,247.72', 'link': '/orders/x', 'readAt': null, 'createdAt': _now},
      {'id': 'n2', 'type': 'inquiry.won', 'title': 'RFQ-2026-0229 won', 'body': null, 'link': '/inquiries/y', 'readAt': _now, 'createdAt': '2026-10-01T09:00:00.000Z'},
    ],
  },
  '/api/customers': {'total': 1, 'page': 1, 'pageSize': 8, 'rows': [{'id': 'c1', 'name': 'Lahore Pharma', 'country': 'PK'}]},
  '/api/inquiries': {'total': 0, 'page': 1, 'pageSize': 8, 'rows': []},
  '/api/factories': {'total': 0, 'page': 1, 'pageSize': 8, 'rows': []},
  '/api/orders': [
    {'id': 'o1', 'refNo': 'SO-2026-0127', 'stage': 'shipped', 'customer': {'name': 'Lahore Pharma'}, 'inquiry': {'title': 'Blister packing machine'}},
    {'id': 'o2', 'refNo': 'SO-2026-0002', 'stage': 'confirmed', 'customer': {'name': 'Karachi Builders'}, 'inquiry': {'title': 'Valve'}},
  ],
};

void main() {
  testWidgets('Home shows what needs me and this month, and passes the accessibility checks', (tester) async {
    await pumpScreen(tester, const HomeScreen(), homeServer);
    expect(find.textContaining('Good '), findsOneWidget);
    expect(find.textContaining('2 things need you'), findsOneWidget);
    expect(find.text('SO-2026-0043: Get the balance (USD 33,140.01)'), findsOneWidget);
    expect(find.text('This month'), findsOneWidget);
    expect(find.text('USD 1.7M'), findsOneWidget);
    await expectAccessible(tester);
  });

  testWidgets('Alerts are grouped by day, unread first in bold, and pass the accessibility checks', (tester) async {
    await pumpScreen(tester, const AlertsScreen(), homeServer);
    expect(find.text('TODAY'), findsOneWidget);
    expect(find.text('Balance late'), findsOneWidget);
    expect(find.text('Unread 1'), findsOneWidget);
    expect(find.text('Mark all read'), findsOneWidget);
    await expectAccessible(tester);
  });

  testWidgets('Search finds orders and customers, grouped, and passes the accessibility checks', (tester) async {
    await pumpScreen(tester, const SearchScreen(), homeServer);
    await tester.enterText(find.byType(TextField), 'lahore');
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pumpAndSettle();
    expect(find.text('Orders · 1'), findsOneWidget);
    expect(find.text('SO-2026-0127'), findsOneWidget);
    expect(find.text('Customers · 1'), findsOneWidget);
    expect(find.text('SO-2026-0002'), findsNothing);
    await expectAccessible(tester);
  });

  test('web links open the app page when the app has it', () {
    expect(appPathFor('/orders/5e258e2e-7869-4225-a99e-4ad5cf0afc68?tab=money'), '/orders/5e258e2e-7869-4225-a99e-4ad5cf0afc68');
    expect(appPathFor('/customers/5e258e2e-7869-4225-a99e-4ad5cf0afc68'), '/customers/5e258e2e-7869-4225-a99e-4ad5cf0afc68');
    expect(appPathFor('/inquiries/5e258e2e-7869-4225-a99e-4ad5cf0afc68/sourcing'), '/inquiries/5e258e2e-7869-4225-a99e-4ad5cf0afc68');
    expect(appPathFor('/factories/5e258e2e-7869-4225-a99e-4ad5cf0afc68'), '/factories/5e258e2e-7869-4225-a99e-4ad5cf0afc68');
    expect(appPathFor('/settings/company'), isNull);
    expect(appPathFor(null), isNull);
  });

  test('times read like people say them', () {
    final now = DateTime(2026, 11, 4, 10);
    expect(fmtWhen(DateTime(2026, 11, 4, 9, 2), now: now), '9:02');
    expect(fmtWhen(DateTime(2026, 11, 3, 18), now: now), 'yesterday');
    expect(fmtShort('1692475.64', 'USD'), 'USD 1.7M');
    expect(fmtShort('44100', 'USD'), 'USD 44.1k');
  });
}
