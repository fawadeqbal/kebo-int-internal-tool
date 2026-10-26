import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';
import 'json.dart';
import 'push.dart';
import 'repository.dart';

/// Default server; changeable on the sign-in screen (Server…), or at build time:
/// flutter build apk --dart-define=API_BASE=https://kebo.example.com
const defaultServer = String.fromEnvironment('API_BASE', defaultValue: 'https://rfq.fawadiqbal.dev');

final prefsProvider = Provider<SharedPreferences>((ref) => throw UnimplementedError('overridden in main'));

final apiProvider = Provider<Api>((ref) {
  final prefs = ref.watch(prefsProvider);
  return Api(baseUrl: prefs.getString('server') ?? defaultServer);
});

final repoProvider = Provider<KeboRepository>((ref) => KeboRepository(ref.watch(apiProvider)));

enum SessionStatus { loading, signedOut, needsCode, signedIn }

@immutable
class Session {
  const Session(this.status, {this.user = const {}, this.message});
  final SessionStatus status;

  /// `{ id, name, email, role, permissions }` from /api/auth/me.
  final Json user;
  final String? message;

  String get role => user.s('role');
  String get userId => user.s('id');
  List<String> get permissions => user.ls('permissions');
  bool can(String permission) => permissions.contains(permission);

  /// Managers (and admins) see every deal and can assign, reopen and cancel orders.
  bool get isManager => can('inquiries.viewAll');
}

const _storage = FlutterSecureStorage();
const _tokenKey = 'kebo_token';

class SessionController extends Notifier<Session> {
  KeboRepository get _repo => ref.read(repoProvider);
  Api get _api => ref.read(apiProvider);

  @override
  Session build() {
    final api = ref.read(apiProvider);
    api.onSignedOut = () => _signedOut('Your session ended. Please sign in again.');
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
    final me = await _repo.me();
    state = Session(SessionStatus.signedIn, user: me);
  }

  /// Step 1: email + password. Throws [ApiException] with the server's message.
  Future<void> signIn(String email, String password) async {
    final res = await _repo.login(email, password);
    // The token is needed for the second step too (sent as the bearer), but is only kept once complete.
    _api.token = res.s('token');
    if (res.b('twoStepRequired')) {
      state = const Session(SessionStatus.needsCode);
      return;
    }
    await _keep(res.s('token'), res.m('user'));
  }

  /// Step 2: the 6-digit code (or a recovery code), with the token from step 1.
  Future<Json> verifyCode(String code) async {
    final res = await _repo.twoStep(code);
    await _keep(_api.token!, res.m('user'));
    return res;
  }

  Future<void> _keep(String token, Json user) async {
    _api.token = token;
    try {
      await _storage.write(key: _tokenKey, value: token);
    } catch (_) {}
    if (user.isEmpty) {
      await refreshMe();
    } else {
      state = Session(SessionStatus.signedIn, user: user);
    }
  }

  void backToSignIn() {
    _api.token = null;
    state = const Session(SessionStatus.signedOut);
  }

  Future<void> signOut() async {
    try {
      final push = Push.token;
      if (push != null) await _repo.forgetDevice(push);
    } catch (_) {}
    try {
      await _repo.logout();
    } catch (_) {}
    await _signedOut(null);
  }

  Future<void> _signedOut(String? message) async {
    _api.token = null;
    unawaited(Push.forget());
    try {
      await _storage.delete(key: _tokenKey);
    } catch (_) {}
    state = Session(SessionStatus.signedOut, message: message);
  }

  Future<void> setServer(String url) async {
    final clean = Api.normalizeServer(url);
    await ref.read(prefsProvider).setString('server', clean);
    _api.baseUrl = clean;
  }
}

final sessionProvider = NotifierProvider<SessionController, Session>(SessionController.new);

/// Categories, currency and company details (GET /api/settings), for the forms.
final settingsProvider = FutureProvider<Json>((ref) async {
  final s = ref.watch(sessionProvider.select((s) => s.status));
  if (s != SessionStatus.signedIn) return <String, dynamic>{};
  return ref.read(repoProvider).settings();
});

/// Active people for "assign to".
final peopleProvider = FutureProvider<List<Json>>((ref) async {
  final s = ref.watch(sessionProvider.select((s) => s.status));
  if (s != SessionStatus.signedIn) return const [];
  return ref.read(repoProvider).people();
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
