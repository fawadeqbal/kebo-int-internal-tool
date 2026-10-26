// The app's own API layer (Api + KeboRepository) against a running Kebo API.
//
//   KEBO_API_URL=http://localhost:4104 flutter test test/api_integration_test.dart
//
// Uses the demo logins (bilal@example.com = staff, manager@example.com = manager).
// Skipped when KEBO_API_URL is not set.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:kebo_rfq/core/api.dart';
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
      expect(me.ls('permissions'), containsAll(['inquiries.create', 'milestones.update']));
      expect(me.ls('permissions'), isNot(contains('milestones.override')));

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

    test('lists my orders and opens one with its checklist', () async {
      final orders = await staff.orders(mine: true);
      expect(orders, isNotEmpty);
      final o = await staff.order(orders.first.s('id'));
      final steps = o.m('plan').l('steps');
      expect(steps, hasLength(12));
      expect(steps.first.keys, containsAll(['key', 'title', 'doneTitle', 'status', 'due', 'overdue', 'hint', 'blockedBy']));
      expect(o.m('plan').mn('next'), isNotNull);
    });

    test('marks a step done, then undoes it', () async {
      final orders = await staff.orders(mine: true);
      final id = orders.first.s('id');
      final before = await staff.order(id);
      final step = before.m('plan').l('steps').firstWhere((s) => s.s('status') == 'todo' && s.mn('blockedBy') == null);
      final key = step.s('key');

      final done = await staff.step(id, 'done', key);
      final doneStep = done.m('plan').l('steps').firstWhere((s) => s.s('key') == key);
      expect(doneStep.s('status'), 'done');
      expect(doneStep.sn('doneOn'), isNotNull);
      expect(done.m('plan').i('done'), before.m('plan').i('done') + 1);

      final undone = await staff.step(id, 'undo', key);
      expect(undone.m('plan').l('steps').firstWhere((s) => s.s('key') == key).s('status'), 'todo');
      expect(undone.m('plan').i('done'), before.m('plan').i('done'));
    });

    test('from quotation to order, and the deposit gate: staff cannot pay the factory first', () async {
      // A fresh deal for a known customer…
      final customers = await staff.customers(q: 'Al-Shifa');
      final deal = await staff.createDeal({
        'customerId': customers.l('rows').first.s('id'),
        'channel': 'email',
        'category': 'Machinery',
        'assigneeId': staffId,
        'items': [
          {'description': 'Gate test machine $tag', 'quantity': '2', 'unit': 'set'},
        ],
      });
      final dealId = deal.s('id');
      // …priced on the web (here: the same API calls the web makes)…
      final draft = await staff.api.get('/api/inquiries/$dealId/quotation/draft');
      final lines = [for (final l in draft.l('lines')) {...l, 'unitPrice': 1500}];
      final rev = await staff.api.post('/api/inquiries/$dealId/quotation/revisions', {...draft, 'lines': lines});

      // …then the phone: mark as sent, customer accepted.
      expect((await staff.revisionStatus(rev.s('id'), 'sent')).s('status'), 'sent');
      final q = await staff.quotation(dealId);
      expect(q.l('revisions').first.s('status'), 'sent');
      expect((await staff.deal(dealId)).s('stage'), 'quoted');
      expect((await staff.revisionStatus(rev.s('id'), 'accepted')).s('status'), 'accepted');

      final won = await staff.deal(dealId);
      expect(won.s('stage'), 'won');
      final orderId = won.l('orders').single.s('id');
      final order = await staff.order(orderId);
      expect(order.s('refNo'), startsWith('SO-'));
      expect(order.m('plan').m('next').s('key'), 'proforma_sent');

      // Paying the factory before the customer's deposit: refused with a clear reason.
      try {
        await staff.step(orderId, 'done', 'factory_deposit');
        fail('expected a 409 deposit_first');
      } on ApiException catch (e) {
        expect(e.status, 409);
        expect(e.code, 'deposit_first');
        expect(e.gate, isTrue);
        expect(e.message, "Wait for the customer's deposit before paying the factory.");
      }
      // Staff cannot skip a required step either.
      await expectLater(staff.step(orderId, 'skip', 'customer_deposit'), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'required_step')));
      // A manager may go past the gate, but only with a note.
      await expectLater(manager.step(orderId, 'done', 'factory_deposit'), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'note_required')));

      // Read-only order tabs answer for a new order too.
      expect((await staff.payments(orderId)).l('payments'), isEmpty);
      expect(await staff.factoryOrders(orderId), isEmpty);
      expect(await staff.invoices(orderId), isEmpty);
      expect((await staff.shipments(orderId)).l('shipments'), isEmpty);
    });

    test('dashboard: my to-do lists the next order steps, late first', () async {
      final d = await staff.dashboard();
      expect(d.keys, containsAll(['counts', 'todo', 'myDeals']));
      final todo = d.l('todo');
      expect(todo, isNotEmpty);
      for (final t in todo) {
        expect(t.m('next').s('title'), isNotEmpty);
      }
      final lateFlags = [for (final t in todo) t.m('next').b('overdue')];
      final firstOnTime = lateFlags.indexOf(false);
      if (firstOnTime >= 0) expect(lateFlags.skip(firstOnTime), everyElement(isFalse), reason: 'late steps come first');
      expect(d.mn('money'), isNull, reason: 'money is for managers');
      expect((await manager.dashboard()).l('newDeals'), isA<List<Json>>());
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
