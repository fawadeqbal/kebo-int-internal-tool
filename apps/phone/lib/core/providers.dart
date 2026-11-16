import 'package:flutter_riverpod/legacy.dart';

import 'api.dart';
import 'session.dart';

/// The RFQ Desk server this build talks to. `--dart-define=KEBO_SERVER=https://…` points
/// a build elsewhere; people can still change it on the sign-in screen.
const defaultServer = String.fromEnvironment('KEBO_SERVER', defaultValue: 'https://rfq.fawadiqbal.dev');

/// The one session of the app: who is signed in, the API, its offline cache and outbox.
/// Overridden in tests with a session on a fake server.
final sessionProvider = ChangeNotifierProvider<Session>((ref) {
  final s = Session(Api(server: defaultServer));
  s.start();
  return s;
});
