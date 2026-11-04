import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kebo_app/core/api.dart';
import 'package:kebo_app/core/keep.dart';
import 'package:kebo_app/core/outbox.dart';

import '../support/harness.dart';

/// An API on the fake server, with kept answers and an outbox in memory, and a probe that
/// says what [online] says (no real timers waiting).
(Api, Outbox, FakeServer, MemoryKeepStore) _setup(Map<String, Object?> answers, {MemoryKeepStore? store}) {
  final server = FakeServer(answers);
  final api = Api(server: 'https://test.example', dio: Dio()..httpClientAdapter = server)..token = 't1';
  api.cache = ReadCache(MemoryKeepStore());
  api.net
    ..probe = (() async => !server.offline)
    ..probeEvery = const Duration(days: 1);
  final s = store ?? MemoryKeepStore();
  return (api, Outbox(api, s)..owner = 'me', server, s);
}

List<String> _sent(FakeServer s) => [for (final c in s.calls) '${c.method} ${c.path}'];

void main() {
  test('online: a chain goes at once, in order, the new id put into the next call', () async {
    final (api, box, server, _) = _setup({'/api/expenses': {'id': 'e1'}, '/api/expenses/e1/receipt': {'ok': true}});
    final ch = box.chain('Expense');
    final made = ch.post('/api/expenses', {'amount': '5'}, idAt: 'id');
    ch.upload('/api/expenses/${Chain.ref(made)}/receipt', Uint8List.fromList([1, 2]), 'r.jpg');
    final sent = await ch.send();
    expect(sent.queued, isFalse);
    expect(sent.first?['id'], 'e1');
    expect(_sent(server), ['POST /api/expenses', 'POST /api/expenses/e1/receipt']);
    expect(box.waiting, 0);
    api.net.stop();
  });

  test('no signal: the chain waits; back online it goes in order with the real id', () async {
    final (api, box, server, _) = _setup({'/api/expenses': {'id': 'e7'}, '/api/expenses/e7/receipt': {'ok': true}});
    server.offline = true;
    final ch = box.chain('Expense · CNY 320');
    final made = ch.post('/api/expenses', {'amount': '320', 'note': 'for {{tmp:nothing}}'}, idAt: 'id');
    ch.upload('/api/expenses/${Chain.ref(made)}/receipt', Uint8List.fromList([9, 9, 9]), 'receipt.jpg');
    final sent = await ch.send();
    expect(sent.queued, isTrue);
    expect(sent.waiting, 1, reason: 'one thing (two calls)');
    expect(api.net.offline, isTrue);

    server.offline = false;
    expect(await api.net.check(), isTrue);
    await box.flush();
    expect(_sent(server), ['POST /api/expenses', 'POST /api/expenses/e7/receipt']);
    expect(box.waiting, 0);
    api.net.stop();
  });

  test('a call the server refuses waits for the person; other things still go; Try again sends it', () async {
    final answers = <String, Object?>{'/api/a': {'id': 'a1'}, '/api/b': {'ok': true}, '/api/c': {'ok': true}};
    final (api, box, server, _) = _setup(answers);
    server.offline = true;
    await (box.chain('First')..post('/api/missing', {'x': 1})..post('/api/b', {})).send();
    await (box.chain('Second')..post('/api/c', {})).send();
    server.offline = false;
    await api.net.check();
    await box.flush();
    expect(_sent(server), ['POST /api/missing', 'POST /api/c'], reason: '/api/b waits behind the refused call of the same thing');
    final g = box.groups.single;
    expect(g.label, 'First');
    expect(g.stuck!.error, 'Not found');
    expect(box.needsYou, 1);

    answers['/api/missing'] = {'ok': true};
    await box.retry(g);
    expect(_sent(server).skip(2), ['POST /api/missing', 'POST /api/b']);
    expect(box.waiting, 0);
    api.net.stop();
  });

  test('what waits survives a restart, the photo too', () async {
    final store = MemoryKeepStore();
    final (api, box, server, _) = _setup({}, store: store);
    server.offline = true;
    await (box.chain('Snap')..upload('/api/orders/o1/files', Uint8List.fromList([7, 7]), 'p.jpg', fields: {'step': 'production'})).send();
    api.net.stop();

    final (api2, box2, server2, _) = _setup({'/api/orders/o1/files': {'id': 'f1'}}, store: store);
    await box2.load();
    expect(box2.waiting, 1);
    expect(box2.groups.single.label, 'Snap');
    await box2.flush();
    expect(_sent(server2), ['POST /api/orders/o1/files']);
    final form = server2.calls.single.data as FormData;
    expect(form.fields.single.value, 'production');
    expect(form.files.single.value.length, 2);
    expect(box2.waiting, 0);
    api2.net.stop();
  });

  test('half sent: what went stays sent; the rest waits with the id it needs', () async {
    final adapter = _Flaky(FakeServer({'/api/orders/o1/payments': {'createdId': 'p5'}, '/api/payments/p5/file': {'ok': true}}), okCalls: 1);
    final api = Api(server: 'https://test.example', dio: Dio()..httpClientAdapter = adapter)..token = 't1';
    api.net
      ..probe = (() async => !adapter.down)
      ..probeEvery = const Duration(days: 1);
    final box = Outbox(api, MemoryKeepStore())..owner = 'me';
    final ch = box.chain('Money received');
    final made = ch.post('/api/orders/o1/payments', {'receivedAmount': '10'}, idAt: 'createdId');
    ch.upload('/api/payments/${Chain.ref(made)}/file', Uint8List.fromList([1]), 'slip.jpg');
    // The signal goes between the two calls.
    final sent = await ch.send();
    expect(sent.queued, isTrue);
    expect(sent.first?['createdId'], 'p5');
    expect(box.steps.single.path, '/api/payments/{{tmp:${made.key}}}/file');
    expect(box.resolved[made.key], 'p5');
    adapter.restore();
    await api.net.check();
    await box.flush();
    expect(adapter.server.calls.last.path, '/api/payments/p5/file');
    expect(box.waiting, 0);
    api.net.stop();
  });

  test('changed by someone else: the guard stops it; Keep mine sends, Keep theirs drops it', () async {
    final answers = <String, Object?>{
      '/api/orders/o1/flow': {
        'factory': {
          'readyBy': [
            {'factoryId': 'f1', 'readyOn': '2026-11-25'},
          ],
        },
      },
      '/api/orders/o1/details': {'ok': true},
    };
    final (api, box, server, _) = _setup(answers);
    server.offline = true;
    await (box.chain('Factory visit')
          ..patch('/api/orders/o1/details', {'readyBy': []},
              guard: {'get': '/api/orders/o1/flow', 'list': 'factory.readyBy', 'where': {'factoryId': 'f1'}, 'field': 'readyOn', 'was': '2026-11-20', 'yours': '2026-12-01'}))
        .send();
    server.offline = false;
    await api.net.check();
    await box.flush();
    final g = box.groups.single;
    expect(g.stuck!.code, 'conflict');
    expect(g.stuck!.errorData, {'theirs': '2026-11-25', 'yours': '2026-12-01'});
    expect(_sent(server), ['GET /api/orders/o1/flow'], reason: 'nothing written over theirs');
    await box.retry(g, dropGuard: true);
    expect(_sent(server).last, 'PATCH /api/orders/o1/details');
    expect(box.waiting, 0);
    api.net.stop();
  });

  test('kept answers: shown with no signal, with their time; a page never opened says so', () async {
    final (api, _, server, _) = _setup({'/api/orders/o1': {'id': 'o1', 'refNo': 'SO-1'}});
    expect((await api.get('/api/orders/o1'))['refNo'], 'SO-1');
    await Future<void>.delayed(Duration.zero); // the copy is written
    server.offline = true;
    expect((await api.get('/api/orders/o1'))['refNo'], 'SO-1');
    expect(api.net.offline, isTrue);
    expect(api.net.asOf, isNotNull);
    expect(() => api.get('/api/orders/o2'), throwsA(isA<ApiException>().having((e) => e.message, 'message', "This order isn't on the phone. Open it once while online.")));
    // Another sign-in on the same phone does not see them.
    api.token = 't2';
    await expectLater(api.get('/api/orders/o1'), throwsA(isA<ApiException>()));
    api.net.stop();
  });
}

/// Answers [okCalls] calls, then has no signal until [restore].
class _Flaky implements HttpClientAdapter {
  _Flaky(this.server, {required this.okCalls});
  final FakeServer server;
  int okCalls;
  bool down = false;

  void restore() {
    down = false;
    okCalls = 1 << 30;
  }

  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? body, Future<void>? cancel) {
    if (okCalls <= 0) down = true;
    if (down) throw DioException.connectionError(requestOptions: o, reason: 'No signal');
    okCalls--;
    return server.fetch(o, body, cancel);
  }

  @override
  void close({bool force = false}) {}
}
