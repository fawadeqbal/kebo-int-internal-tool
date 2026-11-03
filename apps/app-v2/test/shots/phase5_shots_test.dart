// Pictures of the phase 5 screens (run with --update-goldens). Tagged "shots": not part of the normal run.
@Tags(['shots'])
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kebo_app/custom/delivery.dart';
import 'package:kebo_app/custom/factory_visit.dart';
import 'package:kebo_app/custom/paper_make.dart';
import 'package:kebo_app/generated/screens/customer.g.dart';
import 'package:kebo_app/generated/screens/factory.g.dart';

import '../custom/phase5_test.dart' show customerServer, deliveryServer, factoryServer, paperServer, phase5Order, visitServer;
import '../support/harness.dart';
import 'fonts.dart';

void main() {
  setUpAll(loadShotFonts);

  Future<void> shot(WidgetTester tester, String name) async {
    await tester.pumpAndSettle();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('out/$name.png'));
  }

  Future<void> openDeliveryScreen(WidgetTester tester) async {
    await pumpScreen(tester, Builder(builder: (c) => Scaffold(body: Center(child: FilledButton(onPressed: () => openDelivery(c, phase5Order), child: const Text('Go'))))), deliveryServer());
    await tester.tap(find.text('Go'));
    await tester.pumpAndSettle();
  }

  testWidgets('delivery', (tester) async {
    await openDeliveryScreen(tester);
    await shot(tester, 'p1-delivery');
  });

  testWidgets('damaged line with a claim', (tester) async {
    await openDeliveryScreen(tester);
    await tester.tap(find.text('1 · Filler RFC-32'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(ChoiceChip, 'Damaged'));
    await tester.enterText(find.byType(TextField).at(1), 'scratched panel');
    await tester.tap(find.text('Open a claim for it'));
    await shot(tester, 'p2-line');
  });

  testWidgets('factory visit', (tester) async {
    await pumpSheet(tester, (c) => openFactoryVisit(c, phase5Order), answers: visitServer(), permissions: const {'orders.update', 'expenses.manage'});
    await tester.tap(find.text('Passed with notes'));
    await tester.enterText(find.byType(TextField).first, 'Speed 98 bpm at test, label alignment ok');
    await shot(tester, 'p3-visit');
  });

  testWidgets('make a paper', (tester) async {
    await pumpSheet(tester, (c) => openMakePaper(c, orderId: 'o1', kind: 'commercial-invoice', label: 'Commercial invoice'), answers: paperServer());
    await shot(tester, 'p4-make');
  });

  testWidgets('customer', (tester) async {
    await pumpScreen(tester, const CustomerScreen(id: 'c1'), customerServer());
    await shot(tester, 'p5-customer');
  });

  testWidgets('factory', (tester) async {
    await pumpScreen(tester, const FactoryScreen(id: 'f1'), factoryServer());
    await shot(tester, 'p6-factory');
  });
}
