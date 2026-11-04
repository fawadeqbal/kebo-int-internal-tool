// Pictures of the offline screens (run with --update-goldens). Tagged "shots": not part of the normal run.
@Tags(['shots'])
library;

import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kebo_app/custom/factory_visit.dart';
import 'package:kebo_app/custom/home.dart';
import 'package:kebo_app/custom/record_follow_ups.dart';
import 'package:kebo_app/custom/record_notes.dart';
import 'package:kebo_app/custom/waiting.dart';
import 'package:kebo_app/generated/screens/order.g.dart';

import '../custom/home_alerts_search_test.dart' show homeServer;
import '../custom/notes_follow_ups_test.dart' show notesServer;
import '../custom/phase5_test.dart' show phase5Order, visitServer;
import '../support/harness.dart';
import 'fonts.dart';

void _noSignal() {
  lastServer.offline = true;
  lastSession.api.net
    ..probe = (() async => !lastServer.offline)
    ..probeEvery = const Duration(days: 1)
    ..lost();
}

Future<void> _wait(String label, {bool upload = false}) {
  final ch = lastSession.outbox.chain(label);
  upload ? ch.upload('/api/orders/o1/files', Uint8List.fromList([1, 2, 3]), 'p.jpg') : ch.post('/api/expenses', {'amount': '320'});
  return ch.send();
}

void main() {
  setUpAll(loadShotFonts);

  Future<void> shot(WidgetTester tester, String name) async {
    await tester.pumpAndSettle();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('out/$name.png'));
  }

  testWidgets('home offline', (tester) async {
    await pumpScreen(tester, const OfflineBanner(child: HomeScreen()), homeServer);
    _noSignal();
    lastSession.api.net.servedFromCache(DateTime.now().subtract(const Duration(minutes: 12)));
    await _wait('Factory visit · SO-2026-0450 · Wenzhou Pack');
    await _wait('Expense · SO-2026-0450 · CNY 320');
    await _wait('Snap & attach · SO-2026-0450 · fat-video.jpg', upload: true);
    await shot(tester, 'p6-1-home-offline');
    lastSession.api.net.stop();
  });

  testWidgets('factory visit offline', (tester) async {
    await pumpSheet(tester, (c) => openFactoryVisit(c, phase5Order), answers: visitServer(), permissions: const {'orders.update'});
    _noSignal();
    lastSession.api.net.servedFromCache(DateTime.now().subtract(const Duration(minutes: 40)));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Passed with notes'));
    await tester.enterText(find.byType(TextField).first, 'Speed 98 bpm at test, label alignment ok.');
    await shot(tester, 'p6-2-visit-offline');
    lastSession.api.net.stop();
  });

  testWidgets('waiting to send', (tester) async {
    final answers = <String, Object?>{
      '/api/orders/o1/flow': {
        'factory': {
          'readyBy': [
            {'factoryId': 'f1', 'readyOn': '2026-11-25'},
          ],
        },
      },
    };
    await pumpScreen(tester, const OfflineBanner(child: WaitingScreen()), answers);
    _noSignal();
    await (lastSession.outbox.chain('Factory visit · SO-2026-0450 · Wenzhou Pack')
          ..patch('/api/orders/o1/details', {'readyBy': []},
              guard: {'get': '/api/orders/o1/flow', 'list': 'factory.readyBy', 'where': {'factoryId': 'f1'}, 'field': 'readyOn', 'was': '2026-11-20', 'yours': '2026-12-01'}))
        .send();
    await _wait('Snap & attach · SO-2026-0450 · fat-video.jpg', upload: true);
    // A moment of signal: the visit meets someone else's date, the photo is refused.
    lastServer.offline = false;
    lastSession.api.net.offline = false;
    lastSession.outbox.flush().ignore();
    await tester.pumpAndSettle();
    _noSignal();
    lastSession.api.net.offline = false;
    lastSession.api.net.lost();
    await _wait('Expense · SO-2026-0450 · CNY 320');
    await shot(tester, 'p6-3-waiting');
    await tester.tap(find.text('Choose…'));
    await shot(tester, 'p6-4-conflict');
    lastSession.api.net.stop();
  });

  const order = RecordRef('order', 'o1', 'SO-2026-0447 · Lahore Pharma', customerId: 'c1');

  testWidgets('home with today\'s follow-ups', (tester) async {
    await pumpScreen(tester, const HomeScreen(), {...homeServer, ...notesServer()});
    await tester.drag(find.byType(Scrollable).first, const Offset(0, -420));
    await shot(tester, 'p6-5-home-today');
  });

  testWidgets('note after a call', (tester) async {
    await pumpSheet(tester, (c) => openNote(c, order), answers: notesServer());
    await tester.enterText(find.byType(TextField).first, 'Ali says the bank pays the balance on Thursday');
    await tester.tap(find.text('Ali Raza'));
    await shot(tester, 'p6-6-note');
  });

  testWidgets('new follow-up', (tester) async {
    await pumpSheet(tester, (c) => openFollowUp(c, on: order), answers: notesServer());
    await tester.enterText(find.byType(TextField).first, 'Call Ali about the LC balance');
    await tester.enterText(find.byType(TextField).at(1), '11:00');
    await shot(tester, 'p6-7-follow-up');
  });

  testWidgets('order notes and follow-ups', (tester) async {
    await pumpScreen(tester, const OrderScreen(id: 'o1'), notesServer());
    await tester.scrollUntilVisible(find.text('Notes · 2'), 200, scrollable: find.byType(Scrollable).first);
    await tester.drag(find.byType(Scrollable).first, const Offset(0, -60));
    await shot(tester, 'p6-8-order-notes');
  });
}
