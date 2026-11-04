import 'dart:convert';

import 'package:flutter/foundation.dart';

import 'api.dart';
import 'json.dart';
import 'keep.dart';

/// One call waiting to be sent: JSON (POST/PUT/PATCH) or a file upload.
class OutStep {
  OutStep({
    required this.id,
    required this.group,
    required this.label,
    required this.method,
    required this.path,
    required this.owner,
    this.body,
    this.fileName,
    this.fields = const {},
    this.key,
    this.idAt = 'id',
    this.guard,
    DateTime? at,
  }) : at = at ?? DateTime.now();

  final String id, group, label, method, path, owner;
  Object? body;
  final String? fileName;
  final Map<String, String?> fields;

  /// This step's answer gives the real id for `{{tmp:<key>}}` in later steps, read at [idAt].
  final String? key;
  final String idAt;

  /// A value someone else may have changed meanwhile: `{get, list, where, field, was}`.
  Map<String, Object?>? guard;
  final DateTime at;

  /// Why it stopped (the server's words), and its code: "conflict", "reason_needed"…
  String? error, code;
  Json errorData = const {};

  /// The file's bytes while it is being sent at once (kept on disk when it waits).
  Uint8List? bytes;

  bool get isUpload => fileName != null;

  Json toJson() => {
        'id': id, 'group': group, 'label': label, 'method': method, 'path': path, 'owner': owner, 'body': body,
        'fileName': fileName, 'fields': fields, 'key': key, 'idAt': idAt, 'guard': guard, 'at': at.toIso8601String(),
        'error': error, 'code': code, 'errorData': errorData,
      };

  factory OutStep.fromJson(Json j) => OutStep(
        id: j.str('id'), group: j.str('group'), label: j.str('label'), method: j.str('method'), path: j.str('path'),
        owner: j.str('owner'), body: j['body'], fileName: j.strOrNull('fileName'),
        fields: {for (final e in (j['fields'] as Map<String, dynamic>? ?? const {}).entries) e.key: e.value as String?},
        key: j.strOrNull('key'), idAt: j.str('idAt', 'id'), guard: j['guard'] as Map<String, dynamic>?, at: j.date('at'),
      )
        ..error = j.strOrNull('error')
        ..code = j.strOrNull('code')
        ..errorData = j.obj('errorData', (m) => m) ?? const {};
}

/// One thing the person did (a visit, an expense with its receipt): its calls are sent in order.
class OutGroup {
  const OutGroup(this.id, this.label, this.at, this.steps);
  final String id, label;
  final DateTime at;
  final List<OutStep> steps;

  /// The call that stopped, if one did.
  OutStep? get stuck => steps.where((s) => s.error != null).firstOrNull;
}

/// What happened to a chain: sent now (with the answers), or kept to send when online.
class Sent {
  const Sent({required this.queued, this.replies = const [], this.waiting = 0});
  final bool queued;
  final List<Json> replies;

  /// How many things wait to send, this one included.
  final int waiting;

  Json? get first => replies.firstOrNull;
}

/// Writes made with no signal wait here, on the phone, and go in order when the server is back.
/// A create gets a temporary id; later calls in the same chain say `{{tmp:<key>}}` and get the
/// real id once the create has an answer. A call the server refuses waits for the person.
class Outbox extends ChangeNotifier {
  Outbox(this.api, this.store);
  final Api api;
  final KeepStore store;

  /// Who is signed in: only their calls are sent.
  String owner = '';

  final List<OutStep> steps = [];
  final Map<String, String> resolved = {};
  bool _loaded = false, _flushing = false;
  int _seq = 0;

  static const _state = 'outbox.json';
  static final _tmp = RegExp(r'\{\{tmp:([A-Za-z0-9_-]+)\}\}');

  String _newId() => '${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}${(_seq++).toRadixString(36)}';

  Future<void> load() async {
    if (_loaded) return;
    _loaded = true;
    try {
      final s = await store.read(_state);
      if (s == null) return;
      final j = jsonDecode(s) as Map<String, dynamic>;
      steps
        ..clear()
        ..addAll([for (final x in j['steps'] as List<dynamic>? ?? const []) OutStep.fromJson(x as Json)]);
      resolved
        ..clear()
        ..addAll({for (final e in (j['resolved'] as Map<String, dynamic>? ?? const {}).entries) e.key: '${e.value}'});
      notifyListeners();
    } catch (_) {
      // A broken file: start empty rather than not at all.
    }
  }

  Future<void> _save() async {
    if (steps.isEmpty) resolved.clear();
    await store.write(_state, jsonEncode({'steps': [for (final s in steps) s.toJson()], 'resolved': resolved}));
  }

  /// Things waiting (one per thing done, however many calls it takes).
  List<OutGroup> get groups {
    final by = <String, List<OutStep>>{};
    for (final s in steps) {
      (by[s.group] ??= []).add(s);
    }
    return [for (final e in by.entries) OutGroup(e.key, e.value.first.label, e.value.first.at, e.value)];
  }

  int get waiting => groups.length;
  int get needsYou => groups.where((g) => g.stuck != null || g.steps.first.owner != owner).length;

  /// Starts a chain of calls for one thing the person does.
  Chain chain(String label) => Chain._(this, label);

  // ------------------------------------------------------------ sending

  Object? _fill(Object? v) => switch (v) {
        String s => s.replaceAllMapped(_tmp, (m) => resolved[m[1]] ?? m[0]!),
        Map<String, dynamic> m => {for (final e in m.entries) e.key: _fill(e.value)},
        List<dynamic> l => [for (final x in l) _fill(x)],
        _ => v,
      };

  Future<Json> _run(OutStep s) async {
    final path = _fill(s.path) as String;
    if (_tmp.hasMatch(path)) throw ApiException('Something it needs was not sent yet.', status: 409, code: 'waiting_for_earlier');
    final Json reply;
    if (s.isUpload) {
      final bytes = s.bytes ?? await store.readBytes('f${s.id}.bin');
      if (bytes == null) throw ApiException('The file is no longer on the phone.', status: 410, code: 'file_gone');
      reply = await api.upload(path, bytes: bytes, fileName: s.fileName!, fields: {for (final e in s.fields.entries) e.key: _fill(e.value) as String?});
    } else {
      final body = _fill(s.body) ?? const <String, Object?>{};
      reply = switch (s.method) { 'PUT' => await api.put(path, body), 'PATCH' => await api.patch(path, body), _ => await api.post(path, body) };
    }
    if (s.key != null) {
      final id = reply.at(s.idAt);
      if (id != null) resolved[s.key!] = id;
    }
    return reply;
  }

  /// Someone changed the guarded value since it was typed: true, with their value kept for the sheet.
  Future<bool> _conflict(OutStep s) async {
    final g = s.guard!;
    final now = await api.get(g['get']! as String);
    final where = (g['where'] as Map<String, dynamic>?) ?? const {};
    final row = now.listAt(g['list']! as String).where((r) => where.entries.every((e) => r[e.key] == e.value)).firstOrNull;
    final theirs = row?.strOrNull(g['field']! as String);
    if (theirs == g['was']) return false;
    s.errorData = {'theirs': theirs, 'yours': g['yours']};
    return true;
  }

  Future<void> _keep(List<OutStep> list) async {
    for (final s in list) {
      if (s.isUpload && s.bytes != null) {
        await store.writeBytes('f${s.id}.bin', s.bytes!);
        s.bytes = null;
      }
      steps.add(s);
    }
    await _save();
    notifyListeners();
  }

  Future<void> _drop(OutStep s) async {
    steps.remove(s);
    if (s.isUpload) await store.delete('f${s.id}.bin');
  }

  /// Sends what waits, in order. Stops at the first "no signal"; a refused call waits for the
  /// person and holds back the later calls of the same thing (others go on).
  Future<void> flush() async {
    await load();
    if (_flushing || steps.isEmpty) return;
    _flushing = true;
    try {
      final held = <String>{};
      for (final s in List.of(steps)) {
        if (held.contains(s.group) || s.owner != owner) continue;
        if (s.error != null) {
          held.add(s.group);
          continue;
        }
        try {
          if (s.guard != null && await _conflict(s)) {
            s
              ..error = 'Changed by someone else'
              ..code = 'conflict';
            held.add(s.group);
          } else {
            await _run(s);
            await _drop(s);
          }
        } on ApiException catch (e) {
          if (e.offline) break;
          s
            ..error = e.message
            ..code = e.code
            ..errorData = e.data;
          held.add(s.group);
        }
        await _save();
        notifyListeners();
      }
    } finally {
      _flushing = false;
    }
  }

  // ------------------------------------------------------------ the person's choices

  /// Try a stopped thing again, e.g. with the reason the server asked for.
  Future<void> retry(OutGroup g, {Json add = const {}, bool dropGuard = false}) async {
    final s = g.stuck;
    if (s != null) {
      if (add.isNotEmpty && s.body is Map<String, dynamic>) s.body = {...s.body! as Map<String, dynamic>, ...add};
      if (dropGuard) s.guard = null;
      s
        ..error = null
        ..code = null;
      await _save();
    }
    await flush();
  }

  /// "Keep theirs": this call is not sent; the rest of the thing goes on.
  Future<void> skipStuck(OutGroup g) async {
    final s = g.stuck;
    if (s != null) await _drop(s);
    await _save();
    notifyListeners();
    await flush();
  }

  /// Not sent at all.
  Future<void> remove(OutGroup g) async {
    for (final s in g.steps) {
      await _drop(s);
    }
    await _save();
    notifyListeners();
  }

  /// Signing out on purpose: nothing of this person's waits on the phone.
  Future<void> clear() async {
    steps.clear();
    await store.clear();
    notifyListeners();
  }
}

/// The calls for one thing, built in order, then [send].
class Chain {
  Chain._(this._box, this.label) : _group = _box._newId();
  final Outbox _box;
  final String label, _group;
  final _steps = <OutStep>[];

  OutStep _add(String method, String path, Object? body, String? idAt, {Uint8List? bytes, String? fileName, Map<String, String?> fields = const {}, Map<String, Object?>? guard}) {
    final id = _box._newId();
    final s = OutStep(
      id: id, group: _group, label: label, method: method, path: path, owner: _box.owner, body: body,
      fileName: fileName, fields: fields, key: idAt == null ? null : id, idAt: idAt ?? 'id', guard: guard,
    )..bytes = bytes;
    _steps.add(s);
    return s;
  }

  /// `{{tmp:…}}` standing for the id this step's answer gives (at [idAt]).
  static String ref(OutStep s) => '{{tmp:${s.key}}}';

  OutStep post(String path, Object? body, {String? idAt}) => _add('POST', path, body, idAt);
  OutStep put(String path, Object? body, {String? idAt}) => _add('PUT', path, body, idAt);
  OutStep patch(String path, Object? body, {String? idAt, Map<String, Object?>? guard}) => _add('PATCH', path, body, idAt, guard: guard);
  OutStep upload(String path, Uint8List bytes, String fileName, {Map<String, String?> fields = const {}, String? idAt}) =>
      _add('POST', path, null, idAt, bytes: bytes, fileName: fileName, fields: fields);

  /// Sends at once when online (errors other than "no signal" are thrown, as before).
  /// With no signal, what is not sent yet waits on the phone and goes when the server is back.
  Future<Sent> send() async {
    await _box.load();
    final replies = <Json>[];
    if (!_box.api.net.offline) {
      for (final (i, s) in _steps.indexed) {
        try {
          replies.add(await _box._run(s));
        } on ApiException catch (e) {
          if (!e.offline) rethrow;
          await _box._keep(_steps.sublist(i));
          return Sent(queued: true, replies: replies, waiting: _box.waiting);
        }
      }
      return Sent(queued: false, replies: replies, waiting: _box.waiting);
    }
    await _box._keep(_steps);
    return Sent(queued: true, waiting: _box.waiting);
  }
}
