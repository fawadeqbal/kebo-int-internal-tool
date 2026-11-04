import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'api.dart';
import 'files.dart';
import 'json.dart';
import 'keep.dart';
import 'outbox.dart';

enum SessionStatus { starting, signedOut, needsCode, signedIn }

/// The person signed in: `{ id, name, email, role, permissions }` from /api/auth/me.
class Me {
  const Me({required this.id, required this.name, required this.email, required this.permissions, this.role, this.company});

  factory Me.fromJson(Json j) => Me(
        id: j.str('id'),
        name: j.str('name'),
        email: j.str('email'),
        role: j.strOrNull('roleName') ?? j.strOrNull('role'),
        company: j.obj('company', (c) => c.str('name')),
        permissions: {...?(j['permissions'] as List<dynamic>?)?.whereType<String>()},
      );

  final String id, name, email;
  final String? role, company;
  final Set<String> permissions;
}

/// Sign-in state for the whole app. Screens read it through `context.session`.
class Session extends ChangeNotifier {
  /// [kept] and [waiting]: where answers and unsent writes live (folders on the phone; memory in tests).
  Session(this.api, {FlutterSecureStorage? storage, KeepStore? kept, KeepStore? waiting})
      : _storage = storage ?? const FlutterSecureStorage(),
        outbox = Outbox(api, waiting ?? KeepStore.folder('waiting')) {
    api.onSignedOut = _expired;
    api.cache = ReadCache(kept ?? KeepStore.folder('kept'));
    api.net.onBack = _back;
  }

  /// Writes made with no signal, sent when the server is back.
  final Outbox outbox;

  final Api api;
  final FlutterSecureStorage _storage;

  /// Downloads, the kept copies, save and share.
  late final FileStore files = FileStore(api);

  SessionStatus status = SessionStatus.starting;
  Me? me;

  /// Companies to choose from when the email is in more than one: `[{ slug, name }]`.
  List<Json> companies = const [];

  /// Why the person is back at sign-in, when it was not their choice.
  String? notice;

  static const _tokenKey = 'kebo_token';
  static const _serverKey = 'kebo_server';

  /// [perm] null means "everyone may".
  bool can(String? perm) => perm == null || (me?.permissions.contains(perm) ?? false);

  Future<void> start() async {
    final server = await _read(_serverKey);
    if (server != null) api.server = server;
    api.token = await _read(_tokenKey);
    if (api.token == null) return _set(SessionStatus.signedOut);
    try {
      me = Me.fromJson(await api.get('/api/auth/me'));
      _signedIn();
    } on ApiException catch (e) {
      if (e.unauthorized) api.token = null;
      notice = e.unauthorized ? null : e.message;
      _set(SessionStatus.signedOut);
    }
  }

  /// Step 1. Throws [ApiException]; code "choose_company" fills [companies].
  Future<void> signIn(String email, String password, {String? company}) async {
    try {
      final res = await api.post('/api/auth/login', {'email': email.trim(), 'password': password, 'company': ?company});
      companies = const [];
      api.token = res.str('token');
      if (res.boolean('twoStepRequired')) return _set(SessionStatus.needsCode);
      await _finish();
    } on ApiException catch (e) {
      if (e.code == 'choose_company') {
        companies = e.data.list('companies', (c) => c);
        notifyListeners();
      }
      rethrow;
    }
  }

  /// Step 2: the 6-digit code or a recovery code.
  Future<void> verifyCode(String code) async {
    await api.post('/api/auth/two-step', {'code': code.trim()});
    await _finish();
  }

  Future<void> setServer(String server) async {
    api.server = server;
    await _write(_serverKey, api.server);
    notifyListeners();
  }

  Future<void> signOut() async {
    try {
      await api.post('/api/auth/logout');
    } on ApiException {
      // Signed out on this phone either way.
    }
    // On purpose: nothing of theirs stays on the phone.
    await outbox.clear();
    await _clear();
  }

  Future<void> _finish() async {
    me = Me.fromJson(await api.get('/api/auth/me'));
    await _write(_tokenKey, api.token!);
    notice = null;
    _signedIn();
  }

  void _signedIn() {
    outbox.owner = me!.id;
    _set(SessionStatus.signedIn);
    // What waits from last time goes now; the day's work is kept for when there is no signal.
    outbox.flush().ignore();
    precache().ignore();
  }

  void _back() {
    if (status != SessionStatus.signedIn) return;
    outbox.flush().ignore();
    precache().ignore();
  }

  DateTime? _precached;

  /// Reads (and so keeps) what is needed out of signal: my open orders with their steps, my open
  /// inquiries, and the lists the forms choose from. At most every ten minutes.
  Future<void> precache({bool force = false}) async {
    final last = _precached;
    if (!force && last != null && DateTime.now().difference(last) < const Duration(minutes: 10)) return;
    _precached = DateTime.now();
    Future<void> read(String path, [Map<String, Object?>? q]) async {
      try {
        await api.get(path, query: q);
      } on ApiException {
        // best effort: what fails is read again next time
      }
    }

    try {
      for (final p in ['/api/auth/me', '/api/reminders', '/api/me/todo', '/api/settings', '/api/users/people', '/api/customers/names']) {
        await read(p);
      }
      if (can('payments.record')) await read('/api/money/accounts');
      await read('/api/inquiries', {'stage': 'open', 'assignee': 'me'});
      final orders = await api.getList('/api/orders/page', query: {'status': 'open', 'mine': 'true'});
      for (final o in orders.take(30)) {
        final id = o.str('id');
        for (final p in ['', '/steps', '/flow', '/money', '/payments', '/papers', '/files']) {
          await read('/api/orders/$id$p');
        }
      }
    } on ApiException {
      // no signal: next time
    }
  }

  void _expired() {
    notice = 'You were signed out. Sign in again.';
    _clear();
  }

  Future<void> _clear() async {
    await api.cache?.clear().catchError((_) {});
    _precached = null;
    api.token = null;
    me = null;
    await _storage.delete(key: _tokenKey).catchError((_) {});
    _set(SessionStatus.signedOut);
  }

  void _set(SessionStatus s) {
    status = s;
    notifyListeners();
  }

  Future<String?> _read(String k) => _storage.read(key: k).catchError((_) => null);
  Future<void> _write(String k, String v) => _storage.write(key: k, value: v).catchError((_) {});
}
