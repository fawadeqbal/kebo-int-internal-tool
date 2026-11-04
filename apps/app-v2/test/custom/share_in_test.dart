import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kebo_app/app.dart';
import 'package:kebo_app/core/session.dart';
import 'package:kebo_app/core/share_in.dart';
import 'package:kebo_app/custom/new_inquiry.dart';
import 'package:kebo_app/ds/ds.dart';
import 'package:receive_sharing_intent/receive_sharing_intent.dart';

import '../support/harness.dart';

/// The phone's share sheet in a test: [first] is what the app was opened with; [send] shares while it runs.
class FakeShares implements ShareSource {
  FakeShares({this.first});
  Shared? first;
  final _incoming = StreamController<Shared>.broadcast();
  int resets = 0;

  void send(Shared s) => _incoming.add(s);

  @override
  Future<Shared?> initial() async => first;

  @override
  Stream<Shared> get incoming => _incoming.stream;

  @override
  Future<void> reset() async => resets++;
}

final _png = base64Decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
final _pdf = Uint8List.fromList(utf8.encode('%PDF-1.4 URS'));

const _message = 'Need quote for 6000 bph water bottling line\n500ml and 1.5L, with blow moulder and labeller.\nDelivery Lagos. Budget ~80k';

Map<String, Object?> _server() => {
      '/api/customers/names': [
        {'id': 'c1', 'name': 'Lagos Water'},
      ],
      '/api/settings': {
        'sales': {'categories': ['Water bottling']},
      },
      // POST answers the new inquiry; GET (the list behind the form) reads rows.
      '/api/inquiries': {'id': 'i9', 'refNo': 'RFQ-2026-0651', 'title': 'Need quote', 'stage': 'new', 'rows': <Object>[], 'total': 0},
      '/api/inquiries/i9/files': {'id': 'f1'},
    };

Iterable<RequestOptions> _uploads(String path) => lastServer.calls.where((c) => c.method == 'POST' && c.path == path);

Map<String, String> _fields(RequestOptions o) => {for (final f in (o.data as FormData).fields) f.key: f.value};

String _fileName(RequestOptions o) => (o.data as FormData).files.single.value.filename!;

Finder get _sheetList => find.descendant(of: find.byType(ListView).last, matching: find.byType(Scrollable)).first;

Future<void> _choose(WidgetTester tester, String value) async {
  await tester.tap(find.text('Choose').first);
  await tester.pumpAndSettle();
  await tester.tap(find.text(value).last);
  await tester.pumpAndSettle();
}

void main() {
  // The choices (customers, categories) are kept per sign-in: each test has its own server.
  setUp(Choices.clear);

  group('the new inquiry form from a share', () {
    testWidgets('fills the message and title, lists the files and passes the accessibility checks', (tester) async {
      await pumpSheet(
        tester,
        (c) async => await openNewInquiry(
              c,
              text: _message,
              files: [SharedFile('photo.jpg', _png), SharedFile('URS.pdf', _pdf)],
              refused: ['IMG_2.heic: this kind of file cannot be attached'],
            ) !=
            null,
        answers: _server(),
      );
      expect(find.text('New inquiry'), findsOneWidget);
      expect(find.text('Need quote for 6000 bph water bottling line'), findsOneWidget, reason: 'the first line is the title');
      expect(find.text(_message), findsOneWidget, reason: 'the whole message is "Their message"');
      await tester.scrollUntilVisible(find.text('URS.pdf'), 200, scrollable: _sheetList);
      expect(find.text('Files · 2'), findsOneWidget);
      expect(find.text('photo.jpg'), findsOneWidget);
      expect(find.text('Not attached: IMG_2.heic: this kind of file cannot be attached'), findsOneWidget);
      expect(find.text('Sent to the inquiry when it is saved.'), findsOneWidget);
      await expectAccessible(tester);
    });

    testWidgets('saves the inquiry, then sends each file to it', (tester) async {
      MadeInquiry? made;
      await pumpSheet(tester, (c) async {
        made = await openNewInquiry(c, text: _message, files: [SharedFile('photo.jpg', _png), SharedFile('URS.pdf', _pdf)]);
        return made != null;
      }, answers: _server());
      await _choose(tester, 'Lagos Water');
      await _choose(tester, 'Water bottling');
      await tester.tap(find.text('Save inquiry'));
      await tester.pumpAndSettle();

      final body = lastServer.sent('POST', '/api/inquiries')!;
      expect(body['customerId'], 'c1');
      expect(body['category'], 'Water bottling');
      expect(body['requirements'], _message);
      expect(body['title'], 'Need quote for 6000 bph water bottling line');

      final sent = _uploads('/api/inquiries/i9/files').toList();
      expect(sent.map(_fileName), ['photo.jpg', 'URS.pdf'], reason: 'one by one, after the inquiry is saved');
      expect(sent.map((o) => _fields(o)['kind']), ['photo', 'other']);
      expect(lastServer.calls.indexWhere((c) => c.path == '/api/inquiries' && c.method == 'POST'),
          lessThan(lastServer.calls.indexWhere((c) => c.path == '/api/inquiries/i9/files')));
      expect(made?.id, 'i9');
      expect(made?.message, 'Inquiry RFQ-2026-0651 created · 2 files attached');
      expect(find.text('New inquiry'), findsNothing, reason: 'the sheet closed');
    });

    testWidgets('a file can be taken off; one the server refuses is said, the inquiry stays saved', (tester) async {
      MadeInquiry? made;
      final answers = _server()..remove('/api/inquiries/i9/files');
      await pumpSheet(tester, (c) async {
        made = await openNewInquiry(c, text: 'Spare parts', files: [SharedFile('photo.jpg', _png), SharedFile('URS.pdf', _pdf)]);
        return made != null;
      }, answers: answers);
      await _choose(tester, 'Lagos Water');
      await _choose(tester, 'Water bottling');
      await tester.scrollUntilVisible(find.byTooltip('Remove photo.jpg'), 200, scrollable: _sheetList);
      await tester.ensureVisible(find.byTooltip('Remove photo.jpg'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Remove photo.jpg'));
      await tester.pumpAndSettle();
      expect(find.text('Files · 1'), findsOneWidget);
      expect(find.text('photo.jpg'), findsNothing);
      await tester.tap(find.text('Save inquiry'));
      await tester.pumpAndSettle();
      expect(_uploads('/api/inquiries/i9/files').map(_fileName), ['URS.pdf']);
      expect(lastServer.calls.where((c) => c.method == 'POST' && c.path == '/api/inquiries'), hasLength(1), reason: 'not saved twice');
      expect(made?.message, 'Inquiry RFQ-2026-0651 created · 1 file not attached: add it again');
    });
  });

  group('the app', () {
    Session signedOut() {
      FlutterSecureStorage.setMockInitialValues({}); // where the sign-in is kept
      final s = fakeSession({
        ..._server(),
        '/api/auth/login': {'token': 't1'},
        '/api/auth/me': {'id': 'me', 'name': 'Sana', 'email': 'sana@example.com', 'permissions': ['*']},
      });
      s.status = SessionStatus.signedOut;
      s.me = null;
      return s;
    }

    testWidgets('signed out: sign-in comes first, then the shared message opens a new inquiry', (tester) async {
      phoneSize(tester);
      final shares = FakeShares(first: const Shared(text: _message));
      final inbox = ShareInbox(shares);
      await tester.pumpWidget(App(session: signedOut(), shares: inbox));
      await inbox.start();
      await tester.pumpAndSettle();
      expect(find.text('Sign in'), findsWidgets);
      expect(inbox.pending, isNotNull, reason: 'kept while the person signs in');

      await tester.enterText(find.byType(TextField).at(0), 'sana@example.com');
      await tester.enterText(find.byType(TextField).at(1), 'secret');
      await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
      await tester.pumpAndSettle();

      expect(find.text('Save inquiry'), findsOneWidget);
      expect(find.text(_message), findsOneWidget);
      expect(inbox.pending, isNull, reason: 'taken once');
      expect(shares.resets, 1);
    });

    testWidgets('signed in: a share while the app is open opens a new inquiry', (tester) async {
      phoneSize(tester);
      final shares = FakeShares();
      final inbox = ShareInbox(shares);
      await tester.pumpWidget(App(session: fakeSession(_server()), shares: inbox, initialLocation: '/inquiries'));
      await inbox.start();
      await tester.pumpAndSettle();
      expect(find.text('Save inquiry'), findsNothing);

      shares.send(Shared(text: 'Blister packing machine', files: [SharedFile('URS.pdf', _pdf)]));
      await tester.pumpAndSettle();
      expect(find.text('Save inquiry'), findsOneWidget);
      expect(find.text('Blister packing machine'), findsWidgets);
      await tester.scrollUntilVisible(find.text('URS.pdf'), 200, scrollable: _sheetList);
      expect(find.text('Files · 1'), findsOneWidget);
    });

    testWidgets('rfqdesk://inquiries/new?text= opens a new inquiry with the text', (tester) async {
      phoneSize(tester);
      await tester.pumpWidget(App(session: fakeSession(_server()), initialLocation: 'rfqdesk://inquiries/new?text=PVC%20pipe%20110mm'));
      await tester.pumpAndSettle();
      expect(find.text('Save inquiry'), findsOneWidget);
      expect(find.text('PVC pipe 110mm'), findsWidgets);
    });

    testWidgets('/new?text= (the link without its host) does the same', (tester) async {
      phoneSize(tester);
      await tester.pumpWidget(App(session: fakeSession(_server()), initialLocation: '/new?text=Spare%20parts%20kit'));
      await tester.pumpAndSettle();
      expect(find.text('Save inquiry'), findsOneWidget);
      expect(find.text('Spare parts kit'), findsWidgets);
    });

    testWidgets('closing the form without saving goes to the inquiries', (tester) async {
      phoneSize(tester);
      await tester.pumpWidget(App(session: fakeSession(_server()), initialLocation: '/inquiries/new'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Close'));
      await tester.pumpAndSettle();
      expect(find.text('Save inquiry'), findsNothing);
      expect(find.text('Inquiries'), findsWidgets);
    });
  });

  group('the Android share sheet', () {
    TestWidgetsFlutterBinding.ensureInitialized();
    late Directory dir;
    setUp(() => dir = Directory.systemTemp.createTempSync('share'));
    tearDown(() {
      dir.deleteSync(recursive: true);
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(const MethodChannel('rfqdesk/share'), null);
    });

    String file(String name, List<int> bytes) => (File('${dir.path}/$name')..writeAsBytesSync(bytes)).path;

    test('reads the files, keeps the words and leaves out what the server refuses', () async {
      final shared = await DeviceShares().read([
        SharedMediaFile(path: 'Need a quote for PVC pipe', type: SharedMediaType.text, mimeType: 'text/plain'),
        SharedMediaFile(path: file('URS.pdf', _pdf), type: SharedMediaType.file, mimeType: 'application/pdf'),
        SharedMediaFile(path: file('list.txt', utf8.encode('1. pipe')), type: SharedMediaType.text, mimeType: 'text/plain'),
        SharedMediaFile(path: file('IMG_2.heic', [1, 2]), type: SharedMediaType.image, mimeType: 'image/heic'),
        SharedMediaFile(path: '${dir.path}/gone.png', type: SharedMediaType.image, mimeType: 'image/png'),
      ]);
      expect(shared!.text, 'Need a quote for PVC pipe');
      expect(shared.files.map((f) => f.name), ['URS.pdf', 'list.txt']);
      expect(shared.files.first.bytes, _pdf);
      expect(shared.refused, ['IMG_2.heic: this kind of file cannot be attached', 'gone.png: could not be read']);
    });

    test('the words that came with the files (subject and body) come from MainActivity', () async {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
        const MethodChannel('rfqdesk/share'),
        (call) async => call.method == 'text' ? 'RFQ: bottling line\n\nPlease quote, URS attached' : null,
      );
      final shared = await DeviceShares().read([SharedMediaFile(path: file('URS.pdf', _pdf), type: SharedMediaType.file)]);
      expect(shared!.text, 'RFQ: bottling line\n\nPlease quote, URS attached');
      expect(shared.files.single.name, 'URS.pdf');
    });

    test('a link is not a share (the router opens it)', () async {
      expect(await DeviceShares().read([SharedMediaFile(path: 'rfqdesk://inquiries/new?text=x', type: SharedMediaType.url)]), isNull);
    });
  });
}
