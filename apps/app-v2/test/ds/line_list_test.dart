import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kebo_app/core/json.dart';
import 'package:kebo_app/custom/order_lines.dart';
import 'package:kebo_app/ds/ds.dart';

import '../support/harness.dart';

/// An order with 120 goods lines, the way GET /orders/:id gives them.
List<Json> lines120() => [
      for (var i = 1; i <= 120; i++)
        {
          'id': 'l$i',
          'no': '$i',
          'type': 'goods',
          'description': 'Item number $i',
          'quantity': '40',
          'unit': 'rolls',
          'receivedQty': i <= 3 ? '40' : '0',
          'packing': {'packages': i <= 3 ? 2 : null, 'packageType': 'Carton'},
        },
    ];

Future<void> open(WidgetTester tester, Future<bool> Function(BuildContext) go) async {
  await pumpSheet(tester, go, answers: {'/api/orders/o1/receipt': {'ok': true}, '/api/orders/o1/packing': {'ok': true}});
}

void main() {
  testWidgets('goods received: 120 lines, Next › walks down, only changed lines are sent', (tester) async {
    await open(tester, (c) => openGoodsReceived(c, 'o1', 'SO-1', lines120()));
    expect(find.text('3 of 120 received'), findsOneWidget);
    expect(find.text('Not yet 117'), findsOneWidget);
    // Type line 4, Next › to line 5 (keyboard stays on the list).
    final box4 = find.bySemanticsLabel(RegExp(r'^Received for line 4,'));
    await tester.tap(box4);
    await tester.enterText(find.descendant(of: box4, matching: find.byType(EditableText)), '40');
    await tester.testTextInput.receiveAction(TextInputAction.next);
    await tester.pumpAndSettle();
    final box5 = find.descendant(of: find.bySemanticsLabel(RegExp(r'^Received for line 5,')), matching: find.byType(EditableText));
    expect(tester.widget<EditableText>(box5).focusNode.hasFocus, isTrue);
    await tester.enterText(box5, '38');
    await tester.pumpAndSettle();
    expect(find.text('4 of 120 received'), findsOneWidget);
    expect(find.textContaining('1 short'), findsOneWidget);
    await expectAccessible(tester);
    await tester.tap(find.text('Save · 2'));
    await tester.pumpAndSettle();
    final sent = lastServer.sent('PUT', '/api/orders/o1/receipt')!;
    expect(sent['lines'], [
      {'lineId': 'l4', 'receivedQty': 40},
      {'lineId': 'l5', 'receivedQty': 38},
    ]);
  });

  testWidgets('choose many lines and set them all in full', (tester) async {
    await open(tester, (c) => openGoodsReceived(c, 'o1', 'SO-1', lines120()));
    await tester.longPress(find.text('Item number 4'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Item number 5'));
    await tester.tap(find.text('Item number 6'));
    await tester.pumpAndSettle();
    expect(find.text('3 lines chosen'), findsOneWidget);
    await tester.tap(find.text('All in full'));
    await tester.pumpAndSettle();
    expect(find.text('6 of 120 received'), findsOneWidget);
  });

  testWidgets('packing: a line sheet with save & next, and Fill down to the lines below', (tester) async {
    await open(tester, (c) => openPacking(c, 'o1', 'SO-1', lines120()));
    expect(find.text('120 lines not packed'.replaceFirst('120', '117')), findsOneWidget);
    await tester.tap(find.text('Item number 4'));
    await tester.pumpAndSettle();
    expect(find.text('Line 4 · 4 of 120'), findsOneWidget);
    await tester.enterText(find.descendant(of: find.byType(BottomSheet), matching: find.byType(TextField)).first, '3');
    await tester.tap(find.text('Fill down to the lines below'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Fill down'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Save & line 5 ›'));
    await tester.pumpAndSettle();
    expect(find.text('Line 5 · 5 of 120'), findsOneWidget);
    Navigator.of(tester.element(find.text('Line 5 · 5 of 120'))).pop();
    await tester.pumpAndSettle();
    expect(find.text('111 lines not packed'), findsOneWidget, reason: 'line 4 and the 5 below it are packed');
    await tester.tap(find.text('Save · 6'));
    await tester.pumpAndSettle();
    final sent = lastServer.sent('PUT', '/api/orders/o1/packing')!;
    expect((sent['lines'] as List).length, 6);
    expect((sent['lines'] as List).first, containsPair('packages', 3));
  });

  test('items keep parts under their line, numbered, and say which line a new part belongs to', () {
    final items = keyed([
      {'id': 'a', 'description': 'Machine'},
      {'id': 'b', 'description': 'Spares'},
      {'_key': 'p', '_parent': 'b', 'description': 'Seals'},
      {'_key': 'n', 'description': 'New line'},
      {'_key': 'q', '_parent': 'n', 'description': 'New part'},
    ]);
    expect(items.map((i) => i['no']), ['1', '2', '2.1', '3', '3.1']);
    expect(items[2]['parentId'], 'b');
    expect(items[4]['partOf'], 3, reason: 'a new line has no id yet: its position in the list');
  });
}
