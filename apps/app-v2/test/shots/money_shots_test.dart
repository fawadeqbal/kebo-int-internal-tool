// Pictures of the money screens (run with --update-goldens). Tagged "shots": not part of the normal run.
@Tags(['shots'])
library;

import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kebo_app/custom/money.dart';
import 'package:kebo_app/ds/ds.dart';
import 'package:kebo_app/generated/screens/order.g.dart';

import '../custom/money_test.dart' show moneyServer, moneyWaiting;
import '../support/harness.dart';
import 'fonts.dart';

void main() {
  setUpAll(loadShotFonts);

  Future<void> shot(WidgetTester tester, String name) async {
    await tester.pumpAndSettle();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('out/$name.png'));
  }

  Future<void> scrollTo(WidgetTester tester, Finder f, {double by = 0}) async {
    await tester.scrollUntilVisible(f, 200, scrollable: find.byType(Scrollable).first);
    if (by != 0) await tester.drag(find.byType(Scrollable).first, Offset(0, -by));
    await tester.pumpAndSettle();
  }

  testWidgets('order money', (tester) async {
    await pumpScreen(tester, const OrderScreen(id: 'o1'), moneyServer(waiting: moneyWaiting));
    await scrollTo(tester, find.text('The plan'), by: 120);
    await shot(tester, 'm1-order-money');
  });

  testWidgets('money received', (tester) async {
    await pumpSheet(tester, (c) => openMoneyReceived(c, orderId: 'o1', refNo: 'SO-2026-0447', customer: 'Lahore Pharma'), answers: moneyServer());
    await tester.tap(find.text('CNY').first);
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextField, '24247.72'), '172158.81');
    await tester.pumpAndSettle();
    await tester.drag(find.descendant(of: find.byType(FormSheet), matching: find.byType(ListView)), const Offset(0, -900));
    await shot(tester, 'm2-received');
  });

  testWidgets('expense by staff', (tester) async {
    await pumpSheet(tester, (c) => openExpense(c, orderId: 'o1', refNo: 'SO-2026-0447', customer: 'Lahore Pharma'),
        answers: moneyServer(), permissions: const {'orders.update', 'money.submit'});
    await tester.enterText(find.byType(TextField).first, '320');
    await tester.tap(find.text('Inland transport'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('CNY').first);
    await shot(tester, 'm3-expense');
  });

  testWidgets('approve', (tester) async {
    await pumpScreen(tester, const OrderScreen(id: 'o1'), moneyServer(waiting: moneyWaiting));
    await scrollTo(tester, find.text('Money received · USD 24,202.72'));
    await tester.tap(find.text('Money received · USD 24,202.72'));
    await shot(tester, 'm4-approve');
  });

  testWidgets('share receipt', (tester) async {
    final answers = moneyServer()..['/pdf/payment-receipt/o1?ref=pay1'] = Uint8List.fromList('%PDF-1.4'.codeUnits);
    await pumpScreen(tester, const OrderScreen(id: 'o1'), answers);
    await scrollTo(tester, find.text('Payments received · 1'));
    await tester.tap(find.textContaining('RC-2026-0447-1'));
    await shot(tester, 'm5-share');
  });
}
