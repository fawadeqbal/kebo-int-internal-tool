import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import 'api.dart';

/// Push notifications (Firebase Cloud Messaging), Android for now. A bonus: when Firebase
/// isn't set up for this build (no google-services.json), everything here quietly does nothing.
class Push {
  Push._();

  static bool get supported => !kIsWeb && defaultTargetPlatform == TargetPlatform.android;
  static bool _ready = false;
  static String? _token;
  static StreamSubscription<String>? _refresh;

  /// Once at start-up, before the app runs. Never throws.
  static Future<void> init() async {
    if (!supported) return;
    try {
      await Firebase.initializeApp();
      _ready = true;
    } catch (e) {
      debugPrint('[push] off: $e');
    }
  }

  /// After sign-in: ask once, then tell the server this phone's token (POST /api/me/devices).
  static Future<void> register(Api api) async {
    if (!_ready) return;
    try {
      final settings = await FirebaseMessaging.instance.requestPermission();
      if (settings.authorizationStatus == AuthorizationStatus.denied) return;
      // Registration tokens: what the server sends to (as the old app); still supported by FCM.
      // ignore: deprecated_member_use
      final token = await FirebaseMessaging.instance.getToken();
      if (token == null) return;
      _token = token;
      await api.post('/api/me/devices', {'token': token, 'platform': 'android'});
      await _refresh?.cancel();
      // ignore: deprecated_member_use
      _refresh = FirebaseMessaging.instance.onTokenRefresh.listen((t) async {
        _token = t;
        try {
          await api.post('/api/me/devices', {'token': t, 'platform': 'android'});
        } on ApiException {
          // next start
        }
      });
    } catch (e) {
      debugPrint('[push] register failed: $e');
    }
  }

  /// At sign-out: the server forgets this phone, and Firebase makes a new token next time.
  static Future<void> forget(Api api) async {
    final t = _token;
    await _refresh?.cancel();
    _refresh = null;
    _token = null;
    if (!_ready) return;
    try {
      if (t != null) await api.deleteWith('/api/me/devices', {'token': t});
      // ignore: deprecated_member_use
      await FirebaseMessaging.instance.deleteToken();
    } catch (_) {
      // signed out on this phone either way
    }
  }

  /// The link of a tapped notification: while open, from the background, or from closed.
  static Stream<String> get taps => _ready
      ? FirebaseMessaging.onMessageOpenedApp.map((m) => '${m.data['link'] ?? ''}').where((l) => l.isNotEmpty)
      : const Stream.empty();

  static Future<String?> launchLink() async {
    if (!_ready) return null;
    final m = await FirebaseMessaging.instance.getInitialMessage();
    final l = m?.data['link']?.toString();
    return l == null || l.isEmpty ? null : l;
  }

  /// A push that arrives while the app is open (shown as an in-app toast).
  static Stream<RemoteMessage> get foreground => _ready ? FirebaseMessaging.onMessage : const Stream.empty();
}
