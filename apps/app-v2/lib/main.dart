import 'package:flutter/material.dart';

import 'app.dart';
import 'core/api.dart';
import 'core/session.dart';

/// The server the app talks to, unless the person changes it at sign-in.
/// Build with --dart-define=KEBO_SERVER=https://… to point elsewhere.
const defaultServer = String.fromEnvironment('KEBO_SERVER', defaultValue: 'https://rfq.fawadiqbal.dev');

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final session = Session(Api(server: defaultServer));
  runApp(App(session: session));
  await session.start();
}
