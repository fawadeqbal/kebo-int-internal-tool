// The app's own API layer (Api + KeboRepository) against a running Kebo API.
//
//   KEBO_API_URL=http://localhost:4202 flutter test test/api_integration_test.dart
//
// Uses the demo logins (bilal@example.com = staff, manager@example.com = manager).
// Skipped when KEBO_API_URL is not set.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:kebo_rfq/core/api.dart';
import 'package:kebo_rfq/core/format.dart' as f;
import 'package:kebo_rfq/core/json.dart';
import 'package:kebo_rfq/core/repository.dart';

final _url = Platform.environment['KEBO_API_URL'];

Future<KeboRepository> signIn(String email, String password) async {
  final repo = KeboRepository(Api(baseUrl: _url!));
  final res = await repo.login(email, password);
  expect(res.b('twoStepRequired'), isFalse, reason: 'the demo accounts have two-step sign-in off');
  repo.api.token = res.s('token');
  return repo;
}

void main() {
  group('Kebo API, through the app\'s repository', skip: _url == null ? 'Set KEBO_API_URL (e.g. http://localhost:4104) to run against a live API' : null, () {
    late KeboRepository staff;
    late KeboRepository manager;
    late String staffId;
    final tag = DateTime.now().millisecondsSinceEpoch.toRadixString(36);

    setUpAll(() async {
      staff = await signIn('bilal@example.com', 'Demo@12345');
      manager = await signIn('manager@example.com', 'Manager@12345');
      staffId = (await staff.me()).s('id');
    });

    test('signs in and knows who I am and what I may do', () async {
      final me = await staff.me();
      expect(me.s('id'), staffId);
      expect(me.s('email'), 'bilal@example.com');
      expect(me.s('role'), 'staff');
      expect(me.ls('permissions'), containsAll(['inquiries.create', 'orders.update']));
      expect(me.ls('permissions'), isNot(contains('payments.record')));

      // A wrong password is the server's own message, not a crash.
      final wrong = KeboRepository(Api(baseUrl: _url!));
      await expectLater(wrong.login('bilal@example.com', 'nope'), throwsA(isA<ApiException>().having((e) => e.status, 'status', 401)));
    });

    test('lists deals by stage tab and search', () async {
      final open = await staff.deals(stage: 'open', assignee: 'me');
      expect(open.l('rows'), isNotEmpty);
      // Tab counts (stages with no deals are left out): the open tab is new + sourcing + quoted.
      final counts = open.m('counts');
      expect(counts.i('new') + counts.i('sourcing') + counts.i('quoted'), open.i('total'));
      for (final r in open.l('rows')) {
        expect(['new', 'sourcing', 'quoted'], contains(r.s('stage')));
        expect(r.m('assignee').s('id'), staffId);
      }
      final won = await manager.deals(stage: 'won');
      expect(won.l('rows').every((r) => r.s('stage') == 'won'), isTrue);
      final first = open.l('rows').first;
      final found = await staff.deals(stage: 'open', q: first.s('refNo'));
      expect(found.l('rows').map((r) => r.s('id')), contains(first.s('id')));
    });

    test('opens a deal and adds a note', () async {
      final list = await staff.deals(stage: 'open', assignee: 'me');
      final id = list.l('rows').first.s('id');
      final deal = await staff.deal(id);
      expect(deal.s('refNo'), startsWith('RFQ-'));
      expect(deal.l('items'), isNotEmpty);
      expect(deal.m('customer').l('contacts'), isNotEmpty);
      expect(deal.m('allowed').keys, containsAll(['edit', 'hold', 'assign', 'reopen']));

      final note = await staff.addNote(id, 'Called the customer from the phone app ($tag)');
      expect(note.s('body'), contains(tag));
      final after = await staff.deal(id);
      expect(after.l('notes').first.s('body'), contains(tag));
      expect(after.m('people')[note.s('authorId')], 'Bilal');
    });

    test('a deal cannot be marked lost without a reason; hold and resume work', () async {
      final created = await staff.createDeal({
        'customerId': (await staff.customers()).l('rows').first.s('id'),
        'channel': 'whatsapp',
        'category': 'Machinery',
        'assigneeId': staffId,
        'items': [
          {'description': 'Hold test $tag', 'quantity': '1', 'unit': 'pcs'},
        ],
      });
      final id = created.s('id');
      await expectLater(staff.moveStage(id, 'lost'), throwsA(isA<ApiException>().having((e) => e.status, 'status', 422).having((e) => e.message, 'message', 'Choose why the deal was lost')));
      expect((await staff.hold(id, true, note: 'Waiting for drawings')).b('onHold'), isTrue);
      expect((await staff.hold(id, false)).b('onHold'), isFalse);
      final lost = await staff.markLost(id, 'duplicate_or_spam', note: 'test $tag');
      expect(lost.s('stage'), 'lost');
      expect(lost.s('lostReason'), 'duplicate_or_spam');
      // Staff cannot reopen; a manager can.
      await expectLater(staff.reopen(id), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'stage_move')));
      expect((await manager.reopen(id, note: 'Back on')).s('stage'), 'sourcing');
    });

    test('lists orders by stage, each with what it needs now', () async {
      final open = await staff.orders(mine: true);
      expect(open, isNotEmpty);
      for (final o in open) {
        expect(['confirmed', 'in_production', 'shipped'], contains(o.s('stage')));
        expect(o.s('status'), 'open');
        expect(o.m('needs').keys, containsAll(['title', 'due', 'late']));
        expect(o.m('next').s('label'), isNotEmpty);
      }
      final making = await staff.orders(mine: true, stage: 'in_production');
      expect(making, isNotEmpty, reason: 'the demo data has an order of Bilal\'s in production');
      expect(making.every((o) => o.s('stage') == 'in_production'), isTrue);
      final done = await manager.orders(status: 'closed');
      expect(done, isNotEmpty);
      expect(done.every((o) => o.s('stage') == 'done' && o.mn('needs') == null && o.mn('next') == null), isTrue);
      final late = await manager.orders(late: true);
      expect(late.every((o) => o.m('needs').b('late')), isTrue);
    });

    test('opens an order: stage, the one button, money, history, documents; shipping unpaid warns', () async {
      final id = (await staff.orders(mine: true, stage: 'in_production')).first.s('id');
      final o = await staff.order(id);
      expect(o.s('refNo'), startsWith('SO-'));
      expect(o.s('stage'), 'in_production');
      expect(o.m('next'), {'to': 'shipped', 'label': 'Mark as shipped', 'stage': 'Shipped', 'hint': isA<String>()});
      expect(o.m('back'), {'to': 'confirmed', 'label': 'Back to Confirmed'});
      expect(o.m('money').keys, containsAll(['total', 'deposit', 'received', 'due', 'depositDue', 'status']));
      expect(o.l('history').last.s('to'), 'in_production');
      expect(o.l('documents').map((d) => d.s('kind')), ['quotation', 'proforma', 'invoice', 'packing-list']);
      expect(o.l('documents').first.s('revisionId'), isNotEmpty);

      // Balance before shipment, money still due: the server asks to confirm, and nothing moves.
      if (o.s('balanceTerms') == 'before_shipment' && f.toCents(o.m('money')['due']) > 0) {
        try {
          await staff.moveOrder(id, 'shipped', blNo: 'TEST-$tag');
          fail('expected a 409 confirm');
        } on ApiException catch (e) {
          expect(e.status, 409);
          expect(e.needsConfirm, isTrue);
          expect(e.message, contains('the terms say the balance is paid before shipping'));
        }
        expect((await staff.order(id)).s('stage'), 'in_production');
      }
    });

    test('reads the payments of an order (read-only on the phone)', () async {
      final id = (await staff.orders(mine: true, stage: 'in_production')).first.s('id');
      final p = await staff.payments(id);
      expect(p.keys, containsAll(['currency', 'total', 'received', 'due', 'depositDue', 'status', 'payments']));
      expect(p.l('payments'), isNotEmpty);
      final first = p.l('payments').first;
      expect(first.keys, containsAll(['kind', 'amount', 'bankCharges', 'currency', 'paidOn', 'method', 'reference', 'voided']));
      final o = await staff.order(id);
      expect(p['received'], o.m('money')['received']);
      expect(p['due'], o.m('money')['due']);
      // Recording payments is for accounts, on the web.
      await expectLater(
        staff.api.post('/api/orders/$id/payments', {'kind': 'balance', 'amount': '1', 'currency': o.s('currency'), 'paidOn': f.today()}),
        throwsA(isA<ApiException>().having((e) => e.status, 'status', 403)),
      );
    });

    test('gets the data of each document of an order', () async {
      final o = await staff.order((await staff.orders(mine: true, stage: 'in_production')).first.s('id'));
      final n = o.s('refNo').replaceFirst('SO-', '');
      final pi = await staff.orderDocument(o.s('id'), 'proforma');
      expect(pi, containsPair('title', 'Proforma invoice'));
      expect(pi.s('number'), 'PI-$n');
      expect(pi.b('showPrices'), isTrue);
      expect(pi.m('totals')['total'], o.s('total'));
      final inv = await staff.orderDocument(o.s('id'), 'invoice');
      expect(inv.s('number'), 'INV-$n');
      expect(inv.m('totals')['due'], o.m('money')['due']);
      final pl = await staff.orderDocument(o.s('id'), 'packing-list');
      expect(pl.s('number'), 'PL-$n');
      expect(pl.b('showPrices'), isFalse);
      expect(pl.mn('totals'), isNull);
      expect(pl.l('lines').every((l) => l.s('type') == 'goods' && l['unitPrice'] == null), isTrue);
      // The PDFs are made by the web app at the same server.
      expect(KeboRepository.pdfPath('proforma', o.s('id')), '/pdf/proforma/${o.s('id')}');
    });

    test('from quotation to order, then forward with "go ahead anyway" and back', () async {
      // A fresh deal for a known customer…
      final customers = await staff.customers(q: 'Al-Shifa');
      final deal = await staff.createDeal({
        'customerId': customers.l('rows').first.s('id'),
        'channel': 'email',
        'category': 'Machinery',
        'assigneeId': staffId,
        'items': [
          {'description': 'Stage test machine $tag', 'quantity': '2', 'unit': 'set'},
        ],
      });
      final dealId = deal.s('id');
      // …priced on the web (here: the same API calls the web makes)…
      final draft = await staff.api.get('/api/inquiries/$dealId/quotation/draft');
      final lines = [for (final l in draft.l('lines')) {...l, 'unitPrice': 1500}];
      final rev = await staff.api.post('/api/inquiries/$dealId/quotation/revisions', {...draft, 'lines': lines, 'depositPercent': 30});

      // …then the phone: mark as sent, customer accepted.
      expect((await staff.revisionStatus(rev.s('id'), 'sent')).s('status'), 'sent');
      expect((await staff.revisionStatus(rev.s('id'), 'accepted')).s('status'), 'accepted');
      final orderId = (await staff.deal(dealId)).l('orders').single.s('id');
      final order = await staff.order(orderId);
      expect(order.s('stage'), 'confirmed');
      expect(order.m('next').s('label'), 'Start production');
      expect(order.mn('back'), isNull);
      expect(order.m('needs').s('title'), startsWith('Get the deposit'));
      expect(order.l('documents').first.s('revisionId'), rev.s('id'));

      // No deposit yet: the server warns (409 "confirm") and nothing moves…
      try {
        await staff.moveOrder(orderId, 'in_production', readyOn: '2099-12-01');
        fail('expected a 409 confirm');
      } on ApiException catch (e) {
        expect(e.status, 409);
        expect(e.needsConfirm, isTrue);
        expect(e.message, matches(RegExp(r'deposit .* has not been received')));
      }
      expect((await staff.order(orderId)).s('stage'), 'confirmed');

      // …"Go ahead anyway" sends it again with confirm: true and a note.
      final moved = await staff.moveOrder(orderId, 'in_production', confirm: true, readyOn: '2099-12-01', note: 'Customer sent the bank slip ($tag)');
      expect(moved.s('stage'), 'in_production');
      expect(moved.s('readyOn'), '2099-12-01');
      expect(moved.m('back').s('to'), 'confirmed');
      expect(moved.m('needs'), {'title': 'Goods due from the factory', 'due': '2099-12-01', 'late': false});
      final h = moved.l('history').last;
      expect([h.s('from'), h.s('to'), h.b('confirmed'), h.s('note')], ['confirmed', 'in_production', true, 'Customer sent the bank slip ($tag)']);
      expect(h.m('by').s('name'), 'Bilal');

      // One stage at a time.
      await expectLater(
        staff.moveOrder(orderId, 'done'),
        throwsA(isA<ApiException>().having((e) => e.code, 'code', 'not_next_or_previous').having((e) => e.needsConfirm, 'needsConfirm', isFalse)),
      );

      // Back one stage: never asks.
      final back = await staff.moveOrder(orderId, 'confirmed', note: 'Pressed by mistake');
      expect(back.s('stage'), 'confirmed');
      expect(back.l('history').last.s('from'), 'in_production');

      // Nothing received yet on the new order.
      final p = await staff.payments(orderId);
      expect(p.l('payments'), isEmpty);
      expect(p['due'], order.s('total'));
    });

    test('dashboard: my to-do says what each order needs, late first', () async {
      final d = await staff.dashboard();
      expect(d.keys, containsAll(['counts', 'todo', 'myDeals']));
      final todo = d.l('todo');
      expect(todo, isNotEmpty);
      for (final t in todo) {
        expect(t.m('needs').s('title'), isNotEmpty);
        expect(t.m('needs').s('due'), matches(RegExp(r'^\d{4}-\d{2}-\d{2}$')));
      }
      final lateFlags = [for (final t in todo) t.m('needs').b('late')];
      final firstOnTime = lateFlags.indexOf(false);
      if (firstOnTime >= 0) expect(lateFlags.skip(firstOnTime), everyElement(isFalse), reason: 'late ones come first');
      expect((await staff.todo()).map((t) => t.s('id')), containsAll(todo.map((t) => t.s('id'))));
      expect(d.mn('money'), isNull, reason: 'money is for managers');
      final m = await manager.dashboard();
      expect(m.m('money').m('now').keys, containsAll(['toReceive', 'openOrders', 'ordersByStage']));
      expect(m.m('money').m('now').m('ordersByStage').keys, containsAll(['confirmed', 'in_production', 'shipped']));
      expect(m.l('newDeals'), isA<List<Json>>());
    });

    test('customers: search, open, and the duplicate warning with "save anyway"', () async {
      final res = await staff.customers(q: 'Al-Shifa');
      final c = res.l('rows').first;
      final full = await staff.customer(c.s('id'));
      expect(full.l('contacts'), isNotEmpty);
      final phone = full.l('contacts').first.s('phone');

      final body = {
        'type': 'company',
        'name': 'Duplicate check $tag',
        'country': 'NG',
        'contacts': [
          {'name': 'Someone', 'phone': phone, 'isPrimary': true},
        ],
      };
      try {
        await staff.createCustomer(body);
        fail('expected a duplicate warning');
      } on ApiException catch (e) {
        expect(e.status, 409);
        expect(e.duplicate, isTrue);
        expect(e.matches.map((m) => m.s('id')), contains(c.s('id')));
      }
      final saved = await staff.createCustomer(body, allowDuplicate: true);
      expect(saved.s('name'), 'Duplicate check $tag');
    });

    test('notifications: list and mark read; people for "assign to"', () async {
      final n = await staff.notifications();
      expect(n.keys, containsAll(['unread', 'items']));
      final unread = n.l('items').where((x) => x.sn('readAt') == null).toList();
      if (unread.isNotEmpty) {
        await staff.markRead([unread.first.s('id')]);
        expect((await staff.notifications()).i('unread'), n.i('unread') - 1);
      }
      expect((await staff.people()).map((p) => p.s('name')), contains('Bilal'));
    });
  });
}
