import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:kebo_app/core/api.dart';
import 'package:kebo_app/core/scope.dart';
import 'package:kebo_app/core/session.dart';
import 'package:kebo_app/ds/ds.dart';

/// Answers API calls from a map of path → JSON body, like the real server would.
class FakeServer implements HttpClientAdapter {
  FakeServer(this.answers);
  final Map<String, Object?> answers;
  final calls = <RequestOptions>[];

  /// The JSON body of the last [method] call to [path].
  Map<String, dynamic>? sent(String method, String path) {
    for (final c in calls.reversed) {
      if (c.method == method && c.path == path && c.data is Map) return Map<String, dynamic>.from(c.data as Map);
    }
    return null;
  }

  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? body, Future<void>? cancel) async {
    calls.add(o);
    final hit = answers.containsKey(o.path);
    // A file (a PDF, a photo): its bytes as they are.
    if (hit && answers[o.path] is Uint8List) {
      return ResponseBody.fromBytes(answers[o.path]! as Uint8List, 200, headers: {Headers.contentTypeHeader: ['application/pdf']});
    }
    return ResponseBody.fromString(
      jsonEncode(hit ? answers[o.path] : {'error': 'Not found'}),
      hit ? 200 : 404,
      headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
    );
  }

  @override
  void close({bool force = false}) {}
}

/// The fake server of the last screen pumped: what the app asked and sent.
late FakeServer lastServer;

/// Signed in as someone who may do everything.
Session fakeSession(Map<String, Object?> answers, {Set<String> permissions = const {'*'}}) {
  lastServer = FakeServer(answers);
  final dio = Dio()..httpClientAdapter = lastServer;
  final s = _AllowAll(Api(server: 'https://test.example', dio: dio), permissions);
  s.status = SessionStatus.signedIn;
  s.me = Me(id: 'me', name: 'Sana', email: 'sana@example.com', permissions: permissions);
  return s;
}

class _AllowAll extends Session {
  _AllowAll(super.api, this.perms);
  final Set<String> perms;

  @override
  bool can(String? perm) => perm == null || perms.contains('*') || perms.contains(perm);
}

/// A phone screen: 390 × 844 points, like an iPhone 14.
void phoneSize(WidgetTester tester) {
  tester.view.physicalSize = const Size(1170, 2532);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
}

Widget _app(Session session, Widget home) => AppScope(
      session: session,
      child: MaterialApp.router(
        debugShowCheckedModeBanner: false,
        theme: appTheme(Brightness.light),
        routerConfig: GoRouter(routes: [
          GoRoute(path: '/', builder: (c, s) => home),
          GoRoute(path: '/:any(.*)', builder: (c, s) => Scaffold(body: Text('Opened ${s.uri}'))),
        ]),
      ),
    );

/// Shows [screen] at phone size with the server answering from [answers].
/// [permissions]: what the signed-in person may do (everything by default).
Future<void> pumpScreen(WidgetTester tester, Widget screen, Map<String, Object?> answers, {Set<String> permissions = const {'*'}}) async {
  phoneSize(tester);
  await tester.pumpWidget(_app(fakeSession(answers, permissions: permissions), screen));
  await tester.pumpAndSettle();
}

/// Opens a form sheet with [open], at phone size.
Future<void> pumpSheet(WidgetTester tester, Future<bool> Function(BuildContext context) open,
    {Map<String, Object?> answers = const {}, Set<String> permissions = const {'*'}}) async {
  phoneSize(tester);
  await tester.pumpWidget(_app(
    fakeSession(answers, permissions: permissions),
    Builder(builder: (context) => Scaffold(body: Center(child: FilledButton(onPressed: () => open(context), child: const Text('Open'))))),
  ));
  await tester.tap(find.text('Open'));
  await tester.pumpAndSettle();
}

/// The checks Android and iOS reviewers run: tap targets, labels, contrast.
Future<void> expectAccessible(WidgetTester tester) async {
  final handle = tester.ensureSemantics();
  await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
  await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
  await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
  await expectLater(tester, meetsGuideline(textContrastGuideline));
  handle.dispose();
}

