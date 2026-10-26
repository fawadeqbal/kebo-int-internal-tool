import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kebo_rfq/core/api.dart';
import 'package:kebo_rfq/core/format.dart' as f;
import 'package:kebo_rfq/core/json.dart';
import 'package:kebo_rfq/core/repository.dart';
import 'package:kebo_rfq/core/session.dart';
import 'package:kebo_rfq/features/orders/order_detail.dart';
import 'package:kebo_rfq/features/orders/orders.dart';
import 'package:kebo_rfq/theme/colors.dart';
import 'package:kebo_rfq/theme/theme.dart';

/// Fixtures captured from the real API (demo data):
///  - order_in_production.json: GET /api/orders/:id for SO-2026-0001, In production, the factory's
///    ready date (22 Oct 2026) passed, deposit in, balance before shipment still due.
///  - order_shipped.json: SO-2026-0004, Shipped, balance due.
///  - payments_*.json: GET /api/orders/:id/payments; orders_open.json: GET /api/orders.
///  - order_receiving.json: SO-2026-0001 after PUT /receipt: the machines 2 of 2 in (22 Oct),
///    the spare parts kit 1 of 2; no packing list yet.
///  - order_packed.json: the same order with everything in and the packing list made (3 packages,
///    2,002.50 kg gross, 6.350 CBM, container TGHU 123456-7).
Json fixture(String name) => (jsonDecode(File('test/fixtures/$name.json').readAsStringSync()) as Map).cast<String, dynamic>();
List<Json> fixtureList(String name) => (jsonDecode(File('test/fixtures/$name.json').readAsStringSync()) as List).cast<Map>().map((m) => m.cast<String, dynamic>()).toList();

class Call {
  Call(this.to, {this.confirm = false, this.note, this.readyOn, this.shippedOn, this.blNo});
  final String to;
  final bool confirm;
  final String? note, readyOn, shippedOn, blNo;
  @override
  String toString() => 'Call($to, confirm: $confirm, note: $note, readyOn: $readyOn, shippedOn: $shippedOn, blNo: $blNo)';
}

/// The app's repository with the API answers from the fixtures. A forward move with warnings
/// answers 409 "confirm" until it is sent with confirm: true, like the server.
class FakeRepo extends KeboRepository {
  FakeRepo(this.current, this.pay, {this.warning}) : super(Api(baseUrl: 'http://test.invalid'));
  Json current;
  final Json pay;
  final String? warning;
  final calls = <Call>[];
  Json? after;
  final receipts = <(Map<String, num>, String?)>[];
  Json? afterReceipt;
  ApiException? receiptError;

  @override
  Future<Json> recordReceipt(String orderId, Map<String, num> received, {String? on}) async {
    receipts.add((received, on));
    if (receiptError case final e?) throw e;
    current = afterReceipt ?? current;
    return current;
  }

  @override
  Future<Json> order(String id) async => current;

  @override
  Future<Json> payments(String orderId) async => pay;

  @override
  Future<Json> moveOrder(String orderId, String to, {bool confirm = false, String? note, String? readyOn, String? shippedOn, String? blNo}) async {
    calls.add(Call(to, confirm: confirm, note: note, readyOn: readyOn, shippedOn: shippedOn, blNo: blNo));
    final forward = current.m('next').s('to') == to;
    if (forward && warning != null && !confirm) throw Api.errorFromBody(409, {'error': warning, 'code': 'confirm'});
    current = after ?? {...current, 'stage': to};
    return current;
  }
}

class FakeSession extends SessionController {
  FakeSession(this.permissions);
  final List<String> permissions;
  @override
  Session build() => Session(SessionStatus.signedIn, user: {'id': 'u1', 'name': 'Bilal', 'role': 'staff', 'permissions': permissions});
}

Widget app(FakeRepo repo, Widget home, {List<String> permissions = const ['orders.update']}) => ProviderScope(
      overrides: [
        repoProvider.overrideWithValue(repo),
        sessionProvider.overrideWith(() => FakeSession(permissions)),
      ],
      child: MaterialApp(theme: buildTheme(Brightness.light), home: home),
    );

/// Like pumpAndSettle, but a button's spinner keeps turning while its dialog is open.
Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 12; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

void main() {
  Future<void> phone(WidgetTester tester) async {
    tester.view.physicalSize = const Size(420, 4000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
  }

  group('stage bar', () {
    Widget bar(Json o) => MaterialApp(theme: buildTheme(Brightness.light), home: Scaffold(body: OrderStageBar(stage: o.s('stage'), history: o.l('history'))));

    testWidgets('four stages, the current one highlighted, with the days from the history', (tester) async {
      final semantics = tester.ensureSemantics();
      await tester.pumpWidget(bar(fixture('order_in_production')));
      for (final label in ['Confirmed', 'In production', 'Shipped', 'Done']) {
        expect(find.text(label), findsOneWidget);
      }
      expect(find.bySemanticsLabel('Confirmed, done, since 07 Oct 2026'), findsOneWidget);
      expect(find.bySemanticsLabel('In production, current stage, since 12 Oct 2026'), findsOneWidget);
      expect(find.bySemanticsLabel('Shipped'), findsOneWidget);
      expect(find.bySemanticsLabel('Done'), findsOneWidget);
      expect(find.text('07 Oct'), findsOneWidget);
      expect(find.text('12 Oct'), findsOneWidget);
      expect(find.byIcon(Icons.check_rounded), findsOneWidget); // only Confirmed is ticked
      semantics.dispose();
    });

    testWidgets('shipped: three days, two ticks', (tester) async {
      final semantics = tester.ensureSemantics();
      await tester.pumpWidget(bar(fixture('order_shipped')));
      expect(find.bySemanticsLabel('Shipped, current stage, since 10 Oct 2026'), findsOneWidget);
      expect(find.byIcon(Icons.check_rounded), findsNWidgets(2));
      expect(find.text('10 Oct'), findsOneWidget);
      semantics.dispose();
    });

    test('a stage entered twice shows the last time', () {
      const bar = OrderStageBar(stage: 'in_production', history: [
        {'from': null, 'to': 'confirmed', 'at': '2026-10-01T09:00:00.000Z'},
        {'from': 'confirmed', 'to': 'in_production', 'at': '2026-10-02T09:00:00.000Z'},
        {'from': 'in_production', 'to': 'confirmed', 'at': '2026-10-03T09:00:00.000Z'},
        {'from': 'confirmed', 'to': 'in_production', 'at': '2026-10-04T09:00:00.000Z'},
      ]);
      expect(bar.enteredOn('in_production'), '2026-10-04T09:00:00.000Z');
      expect(bar.enteredOn('confirmed'), '2026-10-03T09:00:00.000Z');
      expect(bar.enteredOn('shipped'), isNull);
    });
  });

  group('order screen', () {
    testWidgets('in production: what it needs (late), the one button, money, payments, details, documents, history', (tester) async {
      await phone(tester);
      final o = fixture('order_in_production');
      await tester.pumpWidget(app(FakeRepo(o, fixture('payments_in_production')), OrderDetailScreen(id: o.s('id'))));
      await settle(tester);

      expect(find.text('SO-2026-0001'), findsOneWidget);
      expect(find.text('Al-Shifa Pharma Ltd'), findsOneWidget);
      expect(find.text('The deposit came in and the factory is making the goods.'), findsOneWidget);
      // What it needs now, late, in red words.
      final needs = find.byKey(const ValueKey('needs'));
      expect(find.descendant(of: needs, matching: find.text('Goods due from the factory')), findsOneWidget);
      expect(find.descendant(of: needs, matching: find.text('Was due 22 Oct 2026')), findsOneWidget);
      expect(find.descendant(of: needs, matching: find.text('Late')), findsOneWidget);
      // The one button and the small way back.
      expect(find.text('Mark as shipped'), findsOneWidget);
      expect(find.text('Back to Confirmed'), findsOneWidget);
      // Money and the payments list.
      expect(find.text('USD 43,413.42'), findsOneWidget);
      expect(find.text('USD 13,024.03'), findsNWidgets(2)); // deposit and received
      expect(find.descendant(of: find.byKey(const ValueKey('still-due')), matching: find.text('USD 30,389.39')), findsOneWidget);
      expect(find.text('Deposit · 11 Oct 2026'), findsOneWidget);
      expect(find.textContaining('TT-DEMO-1'), findsOneWidget);
      expect(find.text('Deposit received'), findsOneWidget);
      // Details.
      expect(find.text('FOB Qingdao'), findsOneWidget);
      expect(find.text('22 Oct 2026'), findsOneWidget);
      // Documents, each a PDF.
      for (final label in ['Quotation (accepted)', 'Proforma invoice', 'Packing list']) {
        expect(find.text(label), findsOneWidget);
      }
      expect(find.text('Proforma invoice PI-2026-0001'), findsOneWidget);
      expect(find.byIcon(Icons.picture_as_pdf_outlined), findsNWidgets(3));
      // History, newest first.
      expect(find.text('Confirmed → In production'), findsOneWidget);
      expect(find.text('Order confirmed'), findsOneWidget);
      expect(tester.getTopLeft(find.text('Confirmed → In production')).dy, lessThan(tester.getTopLeft(find.text('Order confirmed')).dy));
      // Nothing of the old checklist.
      expect(find.textContaining('of 12 done'), findsNothing);
      expect(find.text('Factory'), findsNothing);
    });

    testWidgets('shipped: close the order, back to In production, ship date and B/L', (tester) async {
      await phone(tester);
      final o = fixture('order_shipped');
      await tester.pumpWidget(app(FakeRepo(o, fixture('payments_shipped')), OrderDetailScreen(id: o.s('id'))));
      await settle(tester);
      expect(find.text('Close the order'), findsOneWidget);
      expect(find.text('Back to In production'), findsOneWidget);
      expect(find.text(o.m('needs').s('title')), findsOneWidget);
      expect(find.text(f.date(o.s('shippedOn'))), findsWidgets);
      if (o.sn('blNo') != null) expect(find.text(o.s('blNo')), findsOneWidget);
      expect(find.text('In production → Shipped'), findsOneWidget);
    });

    testWidgets('a warning asks to confirm; "Go ahead anyway" resends with confirm and the note', (tester) async {
      await phone(tester);
      final o = fixture('order_in_production');
      const warning = 'USD 30,389.39 is still due, and the terms say the balance is paid before shipping.';
      final repo = FakeRepo(o, fixture('payments_in_production'), warning: warning)..after = fixture('order_shipped');
      await tester.pumpWidget(app(repo, OrderDetailScreen(id: o.s('id'))));
      await settle(tester);

      await tester.tap(find.text('Mark as shipped'));
      await settle(tester);
      // The sheet asks the ship date (today) and the B/L.
      expect(find.text('Ship date'), findsOneWidget);
      expect(find.text(f.date(f.today())), findsOneWidget);
      await tester.enterText(find.byType(TextField).first, 'QDLOS-77');
      await tester.tap(find.byKey(const ValueKey('sheet-go')));
      await settle(tester);

      // The server's warning, in a dialog.
      expect(find.byType(AlertDialog), findsOneWidget);
      expect(find.text('Before it goes to Shipped'), findsOneWidget);
      expect(find.text(warning), findsOneWidget);
      await tester.enterText(find.byKey(const ValueKey('note')), 'Customer promised the balance on Monday');
      await tester.tap(find.text('Go ahead anyway'));
      await settle(tester);

      expect(repo.calls, hasLength(2));
      expect([repo.calls[0].to, repo.calls[0].confirm, repo.calls[0].blNo, repo.calls[0].shippedOn], ['shipped', false, 'QDLOS-77', f.today()]);
      expect([repo.calls[1].to, repo.calls[1].confirm, repo.calls[1].blNo, repo.calls[1].note], ['shipped', true, 'QDLOS-77', 'Customer promised the balance on Monday']);
      // The screen shows the order as the server now has it.
      expect(find.byType(AlertDialog), findsNothing);
      expect(find.text('Close the order'), findsOneWidget);
    });

    testWidgets('cancelling the warning moves nothing', (tester) async {
      await phone(tester);
      final o = fixture('order_in_production');
      final repo = FakeRepo(o, fixture('payments_in_production'), warning: 'Money is still due.');
      await tester.pumpWidget(app(repo, OrderDetailScreen(id: o.s('id'))));
      await settle(tester);
      await tester.tap(find.text('Mark as shipped'));
      await settle(tester);
      await tester.tap(find.byKey(const ValueKey('sheet-go')));
      await settle(tester);
      await tester.tap(find.text('Cancel'));
      await settle(tester);
      expect(repo.calls.map((c) => c.confirm), [false]);
      expect(find.text('Mark as shipped'), findsOneWidget);
    });

    testWidgets('back one stage after a quick check', (tester) async {
      await phone(tester);
      final o = fixture('order_in_production');
      final repo = FakeRepo(o, fixture('payments_in_production'));
      await tester.pumpWidget(app(repo, OrderDetailScreen(id: o.s('id'))));
      await settle(tester);
      await tester.tap(find.text('Back to Confirmed'));
      await settle(tester);
      expect(find.text('Move back to Confirmed?'), findsOneWidget);
      await tester.tap(find.text('Move back'));
      await settle(tester);
      expect(repo.calls.single.to, 'confirmed');
      expect(repo.calls.single.confirm, isFalse);
    });

    testWidgets('without orders.update: no buttons', (tester) async {
      await phone(tester);
      final o = fixture('order_in_production');
      await tester.pumpWidget(app(FakeRepo(o, fixture('payments_in_production')), OrderDetailScreen(id: o.s('id')), permissions: const []));
      await settle(tester);
      expect(find.text('Mark as shipped'), findsNothing);
      expect(find.text('Back to Confirmed'), findsNothing);
      expect(find.text('Goods due from the factory'), findsOneWidget);
    });
  });

  group('orders list', () {
    testWidgets('a card: ref, customer, what it needs and by when, late in red', (tester) async {
      final rows = fixtureList('orders_open');
      final o = rows.firstWhere((r) => r.s('stage') == 'confirmed');
      await tester.pumpWidget(MaterialApp(theme: buildTheme(Brightness.light), home: Scaffold(body: OrderRow(o))));
      expect(find.text(o.s('refNo')), findsOneWidget);
      final title = tester.widget<Text>(find.text(o.m('needs').s('title')));
      expect(find.textContaining(o.m('customer').s('name')), findsOneWidget);
      expect(find.text('Confirmed'), findsOneWidget);
      if (o.m('needs').b('late')) {
        expect(find.text('Late'), findsOneWidget);
        expect(find.textContaining('was due ${f.shortDate(o.m('needs').s('due'))}'), findsOneWidget);
        expect(title.style!.color, AppColors.of(tester.element(find.byType(OrderRow))).bad);
      }
    });

    test('late first, then by when it is due, nothing-needed last', () {
      Json row(String id, {bool late = false, String? due}) => {'id': id, 'needs': due == null ? null : {'title': id, 'due': due, 'late': late}};
      final sorted = byNeed([row('done'), row('later', due: '2026-12-01'), row('late', late: true, due: '2026-10-20'), row('soon', due: '2026-11-01')]);
      expect(sorted.map((r) => r['id']), ['late', 'soon', 'later', 'done']);
    });
  });

  group('goods from the factory', () {
    const machines = '999be6d6-0a7a-48e2-8eac-6930fc763f7c';
    const kit = '8b423b14-defa-4c94-be88-e50e93b9d19c';
    Finder inLine(String id, Finder f) => find.descendant(of: find.byKey(ValueKey('goods-$id')), matching: f);

    testWidgets('each goods line: the factory, 2 / 2 pcs with a bar and the day; what it needs; no packing list yet', (tester) async {
      await phone(tester);
      final o = fixture('order_receiving');
      await tester.pumpWidget(app(FakeRepo(o, fixture('payments_in_production')), OrderDetailScreen(id: o.s('id'))));
      await settle(tester);

      expect(find.text('Goods from the factory'), findsOneWidget);
      expect(find.text('1 of 2 items complete'), findsOneWidget);
      expect(inLine(machines, find.text('Capsule filling machine NJP-1200')), findsOneWidget);
      expect(inLine(machines, find.text('from Jinan Pharma Machinery')), findsOneWidget);
      expect(inLine(machines, find.text('2 / 2 pcs')), findsOneWidget);
      expect(inLine(machines, find.text('22 Oct 2026')), findsOneWidget);
      expect(inLine(kit, find.text('Spare parts kit')), findsOneWidget);
      expect(inLine(kit, find.text('1 / 2 pcs')), findsOneWidget);
      final bars = tester.widgetList<LinearProgressIndicator>(find.descendant(of: find.byKey(const ValueKey('goods')), matching: find.byType(LinearProgressIndicator))).map((b) => b.value).toList();
      expect(bars, [1.0, 0.5]);
      expect(find.descendant(of: find.byKey(const ValueKey('needs')), matching: find.text('Goods coming in from the factory (1 of 2 items complete)')), findsOneWidget);
      expect(find.text('Packing list: not made yet (fill it in on the web)'), findsOneWidget);
      expect(find.byKey(const ValueKey('packing-pdf')), findsNothing);
      expect(find.text('Record received'), findsOneWidget);
      expect(find.text('All received'), findsOneWidget);
      // The goods come right after what the order needs, before the money.
      expect(tester.getTopLeft(find.text('Goods from the factory')).dy, lessThan(tester.getTopLeft(find.text('Money')).dy));
    });

    testWidgets('"Record received": one box per line (prefilled), today, Save sends the totals', (tester) async {
      await phone(tester);
      final o = fixture('order_receiving');
      final repo = FakeRepo(o, fixture('payments_in_production'))..afterReceipt = fixture('order_packed');
      await tester.pumpWidget(app(repo, OrderDetailScreen(id: o.s('id'))));
      await settle(tester);

      await tester.tap(find.text('Record received'));
      await settle(tester);
      expect(find.text('Received from the factory'), findsOneWidget);
      expect(tester.widget<TextField>(find.byKey(const ValueKey('qty-$machines'))).controller?.text, '2');
      expect(tester.widget<TextField>(find.byKey(const ValueKey('qty-$kit'))).controller?.text, '1');
      expect(find.text('from Jinan Pharma Machinery · 2 pcs ordered'), findsNWidgets(2));
      expect(find.text(f.date(f.today())), findsOneWidget);

      // "All 2" fills the ordered quantity.
      await tester.tap(find.byKey(const ValueKey('all-$kit')));
      await tester.pump();
      expect(tester.widget<TextField>(find.byKey(const ValueKey('qty-$kit'))).controller?.text, '2');
      await tester.tap(find.byKey(const ValueKey('receipt-save')));
      await settle(tester);

      expect(repo.receipts.single.$1, {machines: 2, kit: 2});
      expect(repo.receipts.single.$2, f.today());
      expect(find.text('Received from the factory'), findsNothing); // the sheet closed
      expect(find.text('Saved what came in.'), findsOneWidget);
      expect(find.text('All in'), findsOneWidget); // the order as the server now has it
    });

    testWidgets('more than ordered: said on the box, nothing sent; the server\'s refusal stays on the sheet', (tester) async {
      await phone(tester);
      final o = fixture('order_receiving');
      final repo = FakeRepo(o, fixture('payments_in_production'));
      await tester.pumpWidget(app(repo, OrderDetailScreen(id: o.s('id'))));
      await settle(tester);
      await tester.tap(find.text('Record received'));
      await settle(tester);

      await tester.enterText(find.byKey(const ValueKey('qty-$kit')), '3');
      await tester.tap(find.byKey(const ValueKey('receipt-save')));
      await settle(tester);
      expect(find.text('Only 2 pcs were ordered'), findsOneWidget);
      expect(repo.receipts, isEmpty);

      repo.receiptError = Api.errorFromBody(400, {'error': 'Spare parts kit: 3 is more than the 2 pcs ordered.'});
      await tester.enterText(find.byKey(const ValueKey('qty-$kit')), '2');
      await tester.tap(find.byKey(const ValueKey('receipt-save')));
      await settle(tester);
      expect(repo.receipts, hasLength(1));
      expect(find.text('Spare parts kit: 3 is more than the 2 pcs ordered.'), findsOneWidget);
      expect(find.text('Received from the factory'), findsOneWidget); // still open
    });

    testWidgets('"All received": one tap, every line in full, today', (tester) async {
      await phone(tester);
      final o = fixture('order_receiving');
      final repo = FakeRepo(o, fixture('payments_in_production'))..afterReceipt = fixture('order_packed');
      await tester.pumpWidget(app(repo, OrderDetailScreen(id: o.s('id'))));
      await settle(tester);
      await tester.tap(find.text('All received'));
      await settle(tester);
      expect(repo.receipts.single.$1, {machines: 2, kit: 2});
      expect(repo.receipts.single.$2, f.today());
      expect(find.text('All goods marked as received.'), findsOneWidget);
      expect(find.text('All received'), findsNothing);
    });

    testWidgets('packed: all in, the packing list ready with its totals and the PDF', (tester) async {
      await phone(tester);
      final o = fixture('order_packed');
      await tester.pumpWidget(app(FakeRepo(o, fixture('payments_in_production')), OrderDetailScreen(id: o.s('id'))));
      await settle(tester);
      expect(find.text('All in'), findsOneWidget);
      expect(find.text('Everything has come in'), findsOneWidget);
      expect(inLine(kit, find.text('2 / 2 pcs')), findsOneWidget);
      expect(inLine(kit, find.text('25 Oct 2026')), findsOneWidget);
      expect(find.text('Packing list ready — 3 packages, 2,002.50 kg, 6.35 CBM'), findsOneWidget);
      expect(find.text('Container TGHU 123456-7'), findsOneWidget);
      expect(find.byKey(const ValueKey('packing-pdf')), findsOneWidget);
      expect(find.descendant(of: find.byKey(const ValueKey('needs')), matching: find.text('Packed and ready: mark as shipped')), findsOneWidget);
      expect(find.text('Record received'), findsOneWidget);
      expect(find.text('All received'), findsNothing);
    });

    for (final (why, change, permissions) in <(String, Json Function(Json), List<String>)>[
      ('cancelled', (o) => {...o, 'status': 'cancelled', 'cancelled': {'at': '2026-10-25T10:00:00.000Z', 'reason': 'Customer changed plans'}}, const ['orders.update']),
      ('done', (o) => {...o, 'stage': 'done', 'next': null, 'back': null, 'needs': null}, const ['orders.update']),
      ('without orders.update', (o) => o, const []),
    ]) {
      testWidgets('$why: the goods are shown, nothing to change', (tester) async {
        await phone(tester);
        final o = change(fixture('order_receiving'));
        await tester.pumpWidget(app(FakeRepo(o, fixture('payments_in_production')), OrderDetailScreen(id: o.s('id')), permissions: permissions));
        await settle(tester);
        expect(find.text('Goods from the factory'), findsOneWidget);
        expect(inLine(kit, find.text('1 / 2 pcs')), findsOneWidget);
        expect(find.text('Record received'), findsNothing);
        expect(find.text('All received'), findsNothing);
      });
    }

    testWidgets('orders from before (no lines or goods in the answer): no goods section', (tester) async {
      await phone(tester);
      final o = fixture('order_shipped');
      await tester.pumpWidget(app(FakeRepo(o, fixture('payments_shipped')), OrderDetailScreen(id: o.s('id'))));
      await settle(tester);
      expect(find.text('Goods from the factory'), findsNothing);
      expect(tester.takeException(), isNull);
    });
  });

  group('null from migrated data', () {
    testWidgets('every field that can be null: the order screen falls back instead of crashing', (tester) async {
      await phone(tester);
      final o = fixture('order_packed');
      final bare = <String, dynamic>{
        ...o,
        'readyOn': null,
        'shippedOn': null,
        'blNo': null,
        'shipBy': null,
        'incoterm': null,
        'incotermPlace': null,
        'customer': null,
        'inquiry': {...o.m('inquiry'), 'assignee': null, 'assigneeId': null},
        'history': [for (final h in o.l('history')) {...h, 'by': null, 'note': null}],
        'lines': [
          for (final l in o.l('lines'))
            {...l, 'factory': null, 'receivedOn': null, 'unit': null, 'packing': {'packages': null, 'packageType': null, 'netWeightKg': null, 'grossWeightKg': null, 'cbm': null}},
          {'id': 'x', 'type': 'goods', 'description': null, 'quantity': null, 'receivedQty': null, 'receivedOn': null, 'factory': null, 'packing': null},
        ],
        'goods': {...o.m('goods'), 'packedAt': null, 'containerNo': null, 'shippingMarks': null, 'totals': null, 'short': null},
      };
      await tester.pumpWidget(app(FakeRepo(bare, fixture('payments_in_production')), OrderDetailScreen(id: o.s('id'))));
      await settle(tester);
      expect(tester.takeException(), isNull);
      expect(find.text('System · ${f.dateTime(o.l('history').first.s('at'))}'), findsOneWidget);
      expect(find.text('Not known yet'), findsOneWidget); // ready date
      expect(find.text('Not yet'), findsOneWidget); // shipped
      expect(find.text('Not assigned'), findsOneWidget);
      expect(find.textContaining(RegExp('^from ')), findsNothing); // no factory
      expect(find.text('Item'), findsOneWidget); // a line without a description
      expect(find.text('Packing list ready — 0 packages, 0.00 kg, 0 CBM'), findsOneWidget);
      // The sheet too.
      await tester.tap(find.text('Record received'));
      await settle(tester);
      expect(tester.takeException(), isNull);
      expect(find.text('Received from the factory'), findsOneWidget);
    });

    testWidgets('an order row with no needs, customer or person', (tester) async {
      final row = <String, dynamic>{...fixtureList('orders_open').first, 'needs': null, 'customer': null, 'inquiry': {'assignee': null}, 'due': null};
      await tester.pumpWidget(MaterialApp(theme: buildTheme(Brightness.light), home: Scaffold(body: OrderRow(row))));
      expect(tester.takeException(), isNull);
      expect(find.text('Paid and delivered'), findsOneWidget);
    });
  });

  group('warnings before shipping', () {
    // As the server says it (POST /stage → 409 "confirm") for SO-2026-0001 with one line short.
    const three = 'Not everything has come in from the factory (Spare parts kit: 1 of 2 pcs). The packing list is not filled in yet. '
        'USD 30,389.39 is still due, and the terms say the balance is paid before shipping.';

    test('one line per warning; a full stop inside brackets does not split', () {
      expect(warningLines(three), [
        'Not everything has come in from the factory (Spare parts kit: 1 of 2 pcs).',
        'The packing list is not filled in yet.',
        'USD 30,389.39 is still due, and the terms say the balance is paid before shipping.',
      ]);
      expect(warningLines('Not everything has come in from the factory (No. 5 pump: 0 of 2 pcs; Valve 2.5in: 1 of 4 pcs).'), hasLength(1));
      expect(warningLines('The packing list is not filled in yet.'), ['The packing list is not filled in yet.']);
    });

    testWidgets('three warnings: shown as a list in the "Go ahead anyway" dialog', (tester) async {
      await phone(tester);
      final o = fixture('order_receiving');
      final repo = FakeRepo(o, fixture('payments_in_production'), warning: three)..after = fixture('order_shipped');
      await tester.pumpWidget(app(repo, OrderDetailScreen(id: o.s('id'))));
      await settle(tester);
      await tester.tap(find.text('Mark as shipped'));
      await settle(tester);
      await tester.tap(find.byKey(const ValueKey('sheet-go')));
      await settle(tester);
      expect(find.text('Before it goes to Shipped'), findsOneWidget);
      for (var i = 0; i < 3; i++) {
        expect(find.byKey(ValueKey('warning-$i')), findsOneWidget);
      }
      expect(find.text('The packing list is not filled in yet.'), findsOneWidget);
      expect(find.text('Why go ahead? (optional)'), findsOneWidget);
      await tester.tap(find.text('Go ahead anyway'));
      await settle(tester);
      expect(repo.calls.map((c) => c.confirm), [false, true]);
    });
  });
}
