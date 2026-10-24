import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';
import 'json.dart';

/// Default server; changeable on the sign-in screen (Server…), or at build time:
/// flutter build apk --dart-define=API_BASE=https://rfq.example.com
const defaultServer = String.fromEnvironment('API_BASE', defaultValue: 'https://rfq.fawadiqbal.dev');

final prefsProvider = Provider<SharedPreferences>((ref) => throw UnimplementedError('overridden in main'));

final apiProvider = Provider<Api>((ref) {
  final prefs = ref.watch(prefsProvider);
  return Api(baseUrl: prefs.getString('server') ?? defaultServer);
});

enum SessionStatus { loading, signedOut, needsCode, needsSetup, signedIn }

@immutable
class Session {
  const Session(this.status, {this.me, this.challenge, this.message});
  final SessionStatus status;
  final Json? me;
  final String? challenge;
  final String? message;

  Json get user => me?.m('user') ?? const {};
  String get role => user.s('role');
  String get userId => user.s('id');
  List<String> get permissions => me?.ls('permissions') ?? const [];
  bool can(String permission) => permissions.contains(permission);
  bool get isManager => can('queries.viewAll');
  int get unread => me?.i('unreadNotifications') ?? 0;
}

const _storage = FlutterSecureStorage();
const _tokenKey = 'kebo_rfq_token';

class SessionController extends Notifier<Session> {
  Api get _api => ref.read(apiProvider);

  @override
  Session build() {
    final api = ref.read(apiProvider);
    api.onSignedOut = () => _signedOut('Your session ended. Please sign in again.');
    api.onSetupRequired = () {
      if (state.status == SessionStatus.signedIn) state = Session(SessionStatus.needsSetup, me: state.me);
    };
    Future.microtask(_restore);
    return const Session(SessionStatus.loading);
  }

  Future<void> _restore() async {
    String? token;
    try {
      token = await _storage.read(key: _tokenKey);
    } catch (_) {}
    if (token == null) {
      state = const Session(SessionStatus.signedOut);
      return;
    }
    _api.token = token;
    try {
      await refreshMe();
    } on ApiException catch (e) {
      if (e.unauthorized) {
        await _signedOut(null);
      } else {
        // Offline at start-up: keep the token, show the sign-in screen with the reason.
        state = Session(SessionStatus.signedOut, message: e.message);
      }
    }
  }

  Future<void> refreshMe() async {
    final me = await _api.get('/api/v1/me');
    state = Session(me.b('twoStepSetupRequired') ? SessionStatus.needsSetup : SessionStatus.signedIn, me: me);
  }

  /// Step 1: email + password. Throws [ApiException] with the server's message.
  Future<void> signIn(String email, String password) async {
    final res = await _api.post('/api/v1/auth/login', {'email': email.trim(), 'password': password});
    if (res.b('twoStep')) {
      state = Session(SessionStatus.needsCode, challenge: res.s('challenge'));
      return;
    }
    await _useToken(res.s('token'));
  }

  /// Step 2: the 6-digit code (or a recovery code).
  Future<Json> verifyCode(String code) async {
    final res = await _api.post('/api/v1/auth/two-step', {'challenge': state.challenge, 'code': code.trim()});
    await _useToken(res.s('token'));
    return res;
  }

  Future<void> _useToken(String token) async {
    _api.token = token;
    try {
      await _storage.write(key: _tokenKey, value: token);
    } catch (_) {}
    await refreshMe();
    ref.invalidate(metaProvider);
  }

  void backToSignIn() => state = const Session(SessionStatus.signedOut);

  Future<void> signOut() async {
    try {
      await _api.post('/api/v1/auth/logout');
    } catch (_) {}
    await _signedOut(null);
  }

  Future<void> _signedOut(String? message) async {
    _api.token = null;
    try {
      await _storage.delete(key: _tokenKey);
    } catch (_) {}
    state = Session(SessionStatus.signedOut, message: message);
  }

  Future<void> setServer(String url) async {
    final clean = url.trim().replaceAll(RegExp(r'/+$'), '');
    await ref.read(prefsProvider).setString('server', clean);
    _api.baseUrl = clean;
  }
}

final sessionProvider = NotifierProvider<SessionController, Session>(SessionController.new);

/// Labels, categories, people, defaults and company details for the forms.
final metaProvider = FutureProvider<Json>((ref) async {
  final s = ref.watch(sessionProvider.select((s) => s.status));
  if (s != SessionStatus.signedIn) return <String, dynamic>{};
  return ref.read(apiProvider).get('/api/v1/meta');
});

/// Light / dark / system, remembered on the phone.
class ThemeModeController extends Notifier<ThemeMode> {
  @override
  ThemeMode build() {
    final v = ref.read(prefsProvider).getString('theme');
    return ThemeMode.values.firstWhere((m) => m.name == v, orElse: () => ThemeMode.system);
  }

  void set(ThemeMode mode) {
    state = mode;
    ref.read(prefsProvider).setString('theme', mode.name);
  }
}

final themeModeProvider = NotifierProvider<ThemeModeController, ThemeMode>(ThemeModeController.new);
