import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:rfq_desk/core/api.dart';
import 'package:rfq_desk/core/keep.dart';
import 'package:rfq_desk/core/secrets.dart';
import 'package:rfq_desk/core/session.dart';

/// Answers API calls from a map of path → JSON body, like the real server would.
class FakeServer implements HttpClientAdapter {
  FakeServer(this.answers);
  final Map<String, Object?> answers;
  final calls = <RequestOptions>[];

  /// No signal: every call fails the way a phone with no connection does.
  bool offline = false;

  /// The JSON body of the last [method] call to [path].
  Map<String, dynamic>? sent(String method, String path) {
    for (final c in calls.reversed) {
      if (c.method == method && c.path == path && c.data is Map) return Map<String, dynamic>.from(c.data as Map);
    }
    return null;
  }

  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? body, Future<void>? cancel) async {
    if (offline) throw DioException.connectionError(requestOptions: o, reason: 'No signal');
    calls.add(o);
    final hit = answers.containsKey(o.path);
    // An error answer: its status and JSON body.
    if (hit && answers[o.path] is FakeError) {
      final e = answers[o.path]! as FakeError;
      return ResponseBody.fromString(
        jsonEncode(e.body),
        e.status,
        headers: {
          Headers.contentTypeHeader: [Headers.jsonContentType],
        },
      );
    }
    // An answer that depends on what was sent.
    if (hit && answers[o.path] is Object? Function(RequestOptions)) {
      final r = (answers[o.path]! as Object? Function(RequestOptions))(o);
      if (r is FakeError) {
        return ResponseBody.fromString(
          jsonEncode(r.body),
          r.status,
          headers: {
            Headers.contentTypeHeader: [Headers.jsonContentType],
          },
        );
      }
      return ResponseBody.fromString(
        jsonEncode(r),
        200,
        headers: {
          Headers.contentTypeHeader: [Headers.jsonContentType],
        },
      );
    }
    // A file (a PDF, a photo): its bytes as they are.
    if (hit && answers[o.path] is Uint8List) {
      return ResponseBody.fromBytes(
        answers[o.path]! as Uint8List,
        200,
        headers: {
          Headers.contentTypeHeader: ['application/pdf'],
        },
      );
    }
    return ResponseBody.fromString(
      jsonEncode(hit ? answers[o.path] : {'error': 'Not found'}),
      hit ? 200 : 404,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

/// Signed in as someone who may do everything, against [FakeServer] with everything kept in memory.
(Session, FakeServer) fakeSession(Map<String, Object?> answers, {Set<String> permissions = const {'*'}}) {
  final server = FakeServer(answers);
  final s = Session(
    Api(server: 'https://test.example', dio: Dio()..httpClientAdapter = server),
    kept: MemoryKeepStore(),
    waiting: MemoryKeepStore(),
    storage: MemorySecrets(),
  );
  s.status = SessionStatus.signedIn;
  s.me = Me(id: 'me', name: 'Sana', email: 'sana@example.com', permissions: permissions);
  s.outbox.owner = 'me';
  return (s, server);
}

/// The server says no: [status] with the usual `{ error, code?, fieldErrors? }` body.
class FakeError {
  const FakeError(this.status, this.body);
  final int status;
  final Map<String, Object?> body;
}

/// Signed out, on [FakeServer].
(Session, FakeServer) signedOutSession(Map<String, Object?> answers) {
  final server = FakeServer(answers);
  final s = Session(
    Api(server: 'https://test.example', dio: Dio()..httpClientAdapter = server),
    kept: MemoryKeepStore(),
    waiting: MemoryKeepStore(),
    storage: MemorySecrets(),
  );
  s.status = SessionStatus.signedOut;
  return (s, server);
}
