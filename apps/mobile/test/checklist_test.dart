import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kebo_rfq/core/api.dart';
import 'package:kebo_rfq/core/json.dart';
import 'package:kebo_rfq/features/orders/checklist.dart';
import 'package:kebo_rfq/features/orders/order_detail.dart';
import 'package:kebo_rfq/theme/theme.dart';

/// GET /api/orders/:id for SO-2026-0001 as the real API answered it (demo data):
/// 4 of 12 steps done, "confirm the ready date" next and 10 days late, shipping blocked by the inspection.
Json loadOrder() => (jsonDecode(File('test/fixtures/order_so_2026_0001.json').readAsStringSync()) as Map).cast<String, dynamic>();

Widget host(Widget child) => MaterialApp(
      theme: buildTheme(Brightness.light),
      home: Scaffold(body: SingleChildScrollView(padding: const EdgeInsets.all(16), child: child)),
    );

void main() {
  late Json order;
  setUp(() => order = loadOrder());

  Future<void> pump(WidgetTester tester, Widget child) async {
    tester.view.physicalSize = const Size(420, 3200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(host(child));
  }

  testWidgets('shows all 12 steps with progress, done titles for done steps and titles for the rest', (tester) async {
    await pump(tester, OrderChecklist(plan: order.m('plan')));
    expect(find.byType(StepTile), findsNWidgets(12));
    expect(find.text('4 of 12 done'), findsOneWidget);
    expect(find.text('1 late'), findsOneWidget);
    // Done steps read as what happened…
    expect(find.text('Proforma invoice sent'), findsOneWidget);
    expect(find.text('Deposit received'), findsOneWidget);
    expect(find.text("Get the customer's deposit"), findsNothing);
    // …the rest as what to do.
    expect(find.text('Ship the goods'), findsOneWidget);
    expect(find.text('Release the original documents (B/L)'), findsOneWidget);
  });

  testWidgets('highlights the next step with its lateness and hint', (tester) async {
    await pump(tester, OrderChecklist(plan: order.m('plan')));
    final next = find.byKey(const ValueKey('step-factory_confirmed'));
    expect(find.text('NEXT STEP'), findsOneWidget);
    expect(find.descendant(of: next, matching: find.text('NEXT STEP')), findsOneWidget);
    expect(find.descendant(of: next, matching: find.text('Get the factory to confirm the ready date')), findsOneWidget);
    expect(find.descendant(of: next, matching: find.text('Late')), findsOneWidget);
    expect(find.descendant(of: next, matching: find.textContaining('10 days late')), findsOneWidget);
    expect(find.descendant(of: next, matching: find.text('Ask the factory for a firm ready date')), findsOneWidget);
    // Only the next step is marked late; later steps show when they are due.
    expect(find.text('Late'), findsOneWidget);
    expect(find.descendant(of: find.byKey(const ValueKey('step-shipped')), matching: find.textContaining('Due 21 Nov · in 26 days')), findsOneWidget);
  });

  testWidgets('says what blocks a step', (tester) async {
    await pump(tester, OrderChecklist(plan: order.m('plan')));
    expect(find.descendant(of: find.byKey(const ValueKey('step-shipped')), matching: find.text('Pass (or skip) the inspection before shipping.')), findsOneWidget);
    expect(find.descendant(of: find.byKey(const ValueKey('step-documents_released')), matching: find.text('Release the original documents only after the balance is received.')), findsOneWidget);
    expect(find.byIcon(Icons.lock_outline_rounded), findsNWidgets(4)); // two dots + two messages
  });

  testWidgets('staff: done on every open step, skip only on optional ones, undo on settled ones', (tester) async {
    final calls = <String>[];
    await pump(tester, OrderChecklist(plan: order.m('plan'), onAction: (step, action) async => calls.add('$action:${step.s('key')}')));
    expect(find.text('Mark done'), findsNWidgets(8));
    expect(find.text('Skip'), findsNWidgets(3)); // samples, inspection, VAT invoice
    expect(find.text('Undo'), findsNWidgets(4));

    final next = find.byKey(const ValueKey('step-factory_confirmed'));
    await tester.tap(find.descendant(of: next, matching: find.text('Mark done')));
    await tester.pump();
    final firstDone = find.byKey(const ValueKey('step-customer_deposit'));
    await tester.tap(find.descendant(of: firstDone, matching: find.text('Undo')));
    await tester.pump();
    expect(calls, ['done:factory_confirmed', 'undo:customer_deposit']);
  });

  testWidgets('managers may skip any open step; without milestones.update nothing is tappable', (tester) async {
    await pump(tester, OrderChecklist(plan: order.m('plan'), canOverride: true, onAction: (_, _) async {}));
    expect(find.text('Skip'), findsNWidgets(8));
    await pump(tester, OrderChecklist(plan: order.m('plan'), canUpdate: false, onAction: (_, _) async {}));
    expect(find.text('Mark done'), findsNothing);
    expect(find.text('Undo'), findsNothing);
  });

  testWidgets('a refused step shows the rule in plain words', (tester) async {
    await pump(tester, const SizedBox());
    final context = tester.element(find.byType(SizedBox).first);
    final e = Api.errorFromBody(409, {'error': "Wait for the customer's deposit before paying the factory.", 'code': 'deposit_first'});
    showGate(context, e);
    await tester.pumpAndSettle();
    expect(find.text("The customer's deposit comes first"), findsOneWidget);
    expect(find.text("Wait for the customer's deposit before paying the factory."), findsOneWidget);
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsNothing);
  });
}
