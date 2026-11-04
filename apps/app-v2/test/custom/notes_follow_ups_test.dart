import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kebo_app/core/json.dart';
import 'package:kebo_app/custom/record_follow_ups.dart';
import 'package:kebo_app/custom/record_notes.dart';
import 'package:kebo_app/generated/screens/order.g.dart';

import '../support/harness.dart';
import 'money_test.dart' show moneyServer;

final _today = DateTime.now().toIso8601String().substring(0, 10);

Json _note(String id, String kind, String body, {String? contact}) => {
      'id': id,
      'kind': kind,
      'body': body,
      'at': DateTime.now().toUtc().toIso8601String(),
      'contact': contact == null ? null : {'id': 'k1', 'name': contact},
      'author': {'id': 'me', 'name': 'Sana'},
      'createdAt': DateTime.now().toUtc().toIso8601String(),
      'editedAt': null,
      'can': {'edit': true, 'delete': true},
    };

Json _follow(String id, String title, {bool late = false, bool done = false, String? at, String? place}) => {
      'id': id,
      'title': title,
      'kind': 'call',
      'dueOn': late ? DateTime.now().subtract(const Duration(days: 1)).toIso8601String().substring(0, 10) : _today,
      'dueAt': at,
      'place': place,
      'note': null,
      'target': {'type': 'order', 'id': 'o1', 'label': 'SO-2026-0447 · Lahore Pharma'},
      'link': '/orders/o1',
      'assignee': {'id': 'me', 'name': 'Sana'},
      'createdBy': {'id': 'me', 'name': 'Sana'},
      'done': done,
      'doneAt': null,
      'doneBy': null,
      'doneNote': null,
      'late': late,
      'can': {'edit': true, 'done': true, 'delete': true},
    };

/// The order of the money tests, with notes, follow-ups and today's list.
Map<String, Object?> notesServer() => {
      ...moneyServer(),
      '/api/orders/o1/notes': [
        _note('n1', 'call', 'Ali says the bank pays the balance on Thursday', contact: 'Ali Raza'),
        _note('n2', 'visit', 'Saw the blister line running at the factory'),
      ],
      '/api/follow-ups': {
        'rows': [_follow('f1', 'Call Ali about the LC balance', at: '11:00'), _follow('f2', 'Send the B/L copy', done: true)],
        'counts': {'open': 1, 'done': 1, 'late': 0},
        'canViewAll': true,
      },
      '/api/me/today': {
        'today': _today,
        'total': 2,
        'late': 1,
        'rows': [_follow('f3', 'Chase the factory for the ready date', late: true), _follow('f1', 'Call Ali about the LC balance', at: '11:00', place: 'by phone')],
      },
      '/api/customers/c1': {
        'contacts': [
          {'id': 'k1', 'name': 'Ali Raza', 'isPrimary': true},
        ],
      },
      '/api/history': <Object>[],
      '/api/users/people': [
        {'id': 'me', 'name': 'Sana'},
        {'id': 'u2', 'name': 'Bilal'},
      ],
    };

const _order = RecordRef('order', 'o1', 'SO-2026-0447 · Lahore Pharma', customerId: 'c1');

/// Scrolls the page until [f] is built and on screen.
Future<void> _scrollTo(WidgetTester tester, Finder f) async {
  await tester.scrollUntilVisible(f, 200, scrollable: find.byType(Scrollable).first);
  await tester.pumpAndSettle();
}

void _noSignal() {
  lastServer.offline = true;
  lastSession.api.net
    ..probe = (() async => !lastServer.offline)
    ..probeEvery = const Duration(days: 1)
    ..lost();
}

void main() {
  testWidgets('the order shows its notes (kind, who with, by whom) and its follow-ups', (tester) async {
    await pumpScreen(tester, const OrderScreen(id: 'o1'), notesServer());
    await _scrollTo(tester, find.text('Notes · 2'));
    expect(find.text('Ali says the bank pays the balance on Thursday'), findsOneWidget);
    expect(find.textContaining('with Ali Raza · by Sana'), findsOneWidget);
    await _scrollTo(tester, find.text('Follow-ups · 1'));
    expect(find.text('Call Ali about the LC balance'), findsOneWidget);
    expect(find.text('1 done'), findsOneWidget, reason: 'the done one is folded');
    tester.view.physicalSize = const Size(1170, 9000);
    await tester.pumpAndSettle();
    await expectAccessible(tester);
  });

  testWidgets('a note after a call: kind, what happened, with whom, when; sent to the order', (tester) async {
    await pumpSheet(tester, (c) => openNote(c, _order), answers: {...notesServer(), '/api/orders/o1/notes': _note('n9', 'call', 'x')});
    expect(find.text('Note'), findsWidgets);
    expect(find.text('on SO-2026-0447 · Lahore Pharma'), findsOneWidget);
    await tester.enterText(find.byType(TextField).first, 'Ali confirmed the balance on Thursday');
    await tester.tap(find.text('Ali Raza'));
    await tester.pumpAndSettle();
    await expectAccessible(tester);
    await tester.tap(find.text('Save the note'));
    await tester.pumpAndSettle();
    final sent = lastServer.sent('POST', '/api/orders/o1/notes')!;
    expect(sent['kind'], 'call');
    expect(sent['body'], 'Ali confirmed the balance on Thursday');
    expect(sent['contactId'], 'k1');
    expect(sent['at'], endsWith('Z'));
    expect(find.text('Note saved'), findsOneWidget);
  });

  testWidgets('with no signal a note waits on the phone and nothing is sent', (tester) async {
    await pumpSheet(tester, (c) => openNote(c, _order), answers: notesServer());
    _noSignal();
    await tester.pumpAndSettle();
    expect(find.text('Save · sends when online'), findsOneWidget);
    await tester.enterText(find.byType(TextField).first, 'Called from the factory, no signal');
    await tester.tap(find.text('Save · sends when online'));
    await tester.pumpAndSettle();
    expect(lastServer.sent('POST', '/api/orders/o1/notes'), isNull);
    expect(lastSession.outbox.waiting, 1);
    lastSession.api.net.stop();
  });

  testWidgets('a new follow-up on the order: what, when, for whom', (tester) async {
    await pumpSheet(tester, (c) => openFollowUp(c, on: _order), answers: {...notesServer(), '/api/follow-ups': _follow('f9', 'x')});
    expect(find.text('New follow-up'), findsOneWidget);
    await tester.enterText(find.byType(TextField).first, 'Call Ali about the LC balance');
    await tester.enterText(find.byType(TextField).at(1), '11:00');
    await tester.pumpAndSettle();
    await expectAccessible(tester);
    await tester.tap(find.text('Add the follow-up'));
    await tester.pumpAndSettle();
    final sent = lastServer.sent('POST', '/api/follow-ups')!;
    expect(sent['title'], 'Call Ali about the LC balance');
    expect(sent['orderId'], 'o1');
    expect(sent['dueOn'], _today);
    expect(sent['dueAt'], '11:00');
    expect(sent['assigneeId'], 'me');
    expect(sent['kind'], 'call');
  });

  testWidgets('Home today: late ones say late; the circle marks one done', (tester) async {
    await pumpScreen(tester, const Scaffold(body: SingleChildScrollView(child: TodayCard())), {...notesServer(), '/api/follow-ups/f1/done': _follow('f1', 'x', done: true)});
    expect(find.text('Follow-ups today · 2'), findsOneWidget);
    expect(find.text('1 is late'), findsOneWidget);
    expect(find.textContaining('late · yesterday'), findsOneWidget);
    await expectAccessible(tester);
    await tester.tap(find.byTooltip('Mark done: Call Ali about the LC balance'));
    await tester.pumpAndSettle();
    expect(lastServer.calls.any((c) => c.method == 'POST' && c.path == '/api/follow-ups/f1/done'), isTrue);
  });

  testWidgets('the follow-ups list: mine to do, done, and everyone\'s; a row opens it in full', (tester) async {
    await pumpScreen(tester, const FollowUpsScreen(), notesServer());
    expect(find.text('To do'), findsOneWidget);
    expect(find.text('Everyone · to do'), findsOneWidget);
    expect(find.text('Call Ali about the LC balance'), findsOneWidget);
    await expectAccessible(tester);
    await tester.tap(find.text('Call Ali about the LC balance'));
    await tester.pumpAndSettle();
    expect(find.text('Done, with a note'), findsOneWidget);
    expect(find.text('Open SO-2026-0447 · Lahore Pharma'), findsOneWidget);
  });
}
