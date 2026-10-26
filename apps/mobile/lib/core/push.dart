import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/painting.dart' show Color;
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import 'api.dart';

/// Phone push notifications (Firebase Cloud Messaging). Android only for now:
/// iPhone needs an Apple push key and GoogleService-Info.plist first.
class Push {
  Push._();

  static bool get supported => !kIsWeb && defaultTargetPlatform == TargetPlatform.android;
  static bool _ready = false;
  static String? _token;
  static StreamSubscription<String>? _refresh;

  /// Notifications the app itself puts in the phone's notification shade while it is open
  /// (Android only shows pushes there when the app is closed or in the background).
  static final _local = FlutterLocalNotificationsPlugin();
  static final _taps = StreamController<String?>.broadcast();
  static int _seq = 0;

  /// Called once at start-up (before runApp). Never throws: push is a bonus.
  static Future<void> init() async {
    if (!supported) return;
    try {
      await Firebase.initializeApp(); // reads android/app/google-services.json
      _ready = true;
      await _local.initialize(
        settings: const InitializationSettings(android: AndroidInitializationSettings('ic_stat_notify')),
        onDidReceiveNotificationResponse: (r) => _taps.add(r.payload),
      );
    } catch (e) {
      debugPrint('[push] Firebase not available: $e');
    }
  }

  /// After sign-in: ask once for permission, then tell the server this phone's token.
  static Future<void> register(Api api) async {
    if (!_ready) return;
    try {
      final settings = await FirebaseMessaging.instance.requestPermission();
      if (settings.authorizationStatus == AuthorizationStatus.denied) return;
      // Registration tokens: still fully supported by FCM next to the newer
      // installation IDs (register()/onRegistered), and what the server sends to.
      // ignore: deprecated_member_use
      final token = await FirebaseMessaging.instance.getToken();
      if (token == null) return;
      _token = token;
      await api.post('/api/v1/devices', {'token': token, 'platform': 'android'});
      await _refresh?.cancel();
      // ignore: deprecated_member_use
      _refresh = FirebaseMessaging.instance.onTokenRefresh.listen((t) async {
        _token = t;
        try {
          await api.post('/api/v1/devices', {'token': t, 'platform': 'android'});
        } catch (_) {}
      });
    } catch (e) {
      debugPrint('[push] register failed: $e');
    }
  }

  /// The token to send with sign-out, so the server stops pushing to this phone.
  static String? get token => _token;

  /// After sign-out: forget the token (a new one is made at the next sign-in).
  static Future<void> forget() async {
    await _refresh?.cancel();
    _refresh = null;
    _token = null;
    if (!_ready) return;
    try {
      // ignore: deprecated_member_use
      await FirebaseMessaging.instance.deleteToken();
    } catch (_) {}
  }

  /// Shows a push that arrived while the app is open as its own notification in the
  /// phone's notification shade: each one stays until it is tapped or cleared, so several stack up.
  static Future<void> showInShade(RemoteMessage m) async {
    if (!_ready) return;
    final title = m.notification?.title ?? 'New notification';
    final body = m.notification?.body ?? '';
    try {
      await _local.show(
        id: (DateTime.now().millisecondsSinceEpoch ~/ 1000 + _seq++) & 0x7fffffff,
        title: title,
        body: body,
        payload: m.data['link']?.toString(),
        notificationDetails: NotificationDetails(
          android: AndroidNotificationDetails(
            'kebo_updates',
            'Updates',
            importance: Importance.high,
            priority: Priority.high,
            icon: 'ic_stat_notify',
            color: const Color(0xFF0B5ED7),
            styleInformation: BigTextStyleInformation(body),
          ),
        ),
      );
    } catch (e) {
      debugPrint('[push] could not show the notification: $e');
    }
  }

  /// Tapping one of those notifications (the link to open).
  static Stream<String?> get onShadeTap => _taps.stream;

  /// The link of the shade notification that started the app from closed, if any.
  static Future<String?> launchLink() async {
    if (!_ready) return null;
    try {
      final d = await _local.getNotificationAppLaunchDetails();
      return d?.didNotificationLaunchApp == true ? d!.notificationResponse?.payload : null;
    } catch (_) {
      return null;
    }
  }

  /// Notifications that arrive while the app is open.
  static Stream<RemoteMessage> get onForeground => _ready ? FirebaseMessaging.onMessage : const Stream.empty();

  /// Tapping a notification while the app was in the background.
  static Stream<RemoteMessage> get onOpened => _ready ? FirebaseMessaging.onMessageOpenedApp : const Stream.empty();

  /// The notification that started the app from closed, if any.
  static Future<RemoteMessage?> initial() async => _ready ? FirebaseMessaging.instance.getInitialMessage() : null;
}
