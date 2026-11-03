import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'api.dart';
import 'json.dart';

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
  Session(this.api, {FlutterSecureStorage? storage}) : _storage = storage ?? const FlutterSecureStorage() {
    api.onSignedOut = _expired;
  }

  final Api api;
  final FlutterSecureStorage _storage;

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
      _set(SessionStatus.signedIn);
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
    await _clear();
  }

  Future<void> _finish() async {
    me = Me.fromJson(await api.get('/api/auth/me'));
    await _write(_tokenKey, api.token!);
    notice = null;
    _set(SessionStatus.signedIn);
  }

  void _expired() {
    notice = 'You were signed out. Sign in again.';
    _clear();
  }

  Future<void> _clear() async {
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
