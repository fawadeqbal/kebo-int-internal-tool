import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'app.dart';
import 'core/api.dart';
import 'core/session.dart';
import 'core/share_in.dart';

/// The server the app talks to, unless the person changes it at sign-in.
/// Build with --dart-define=KEBO_SERVER=https://… to point elsewhere.
const defaultServer = String.fromEnvironment('KEBO_SERVER', defaultValue: 'https://rfq.fawadiqbal.dev');

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final session = Session(Api(server: defaultServer));
  // Share → RFQ Desk (Android's share sheet) opens a new inquiry.
  final shares = !kIsWeb && defaultTargetPlatform == TargetPlatform.android ? ShareInbox(DeviceShares()) : null;
  // A link (a notification, a web address, rfqdesk://…) opens its own page, not Home.
  final link = WidgetsBinding.instance.platformDispatcher.defaultRouteName;
  runApp(App(session: session, shares: shares, initialLocation: link == '/' || link.isEmpty ? '/home' : link));
  await Future.wait([session.start(), if (shares != null) shares.start()]);
}
