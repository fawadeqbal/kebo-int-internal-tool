import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/links.dart';
import '../core/providers.dart';
import '../core/push.dart';
import '../core/session.dart';
import 'router.dart';

/// Push, tied to the session: registered at sign-in, forgotten at sign-out; a tapped
/// notification opens its page; one that arrives while the app is open refreshes the bell.
final pushWiringProvider = Provider<void>((ref) {
  final s = ref.watch(sessionProvider.notifier);
  final router = ref.watch(routerProvider);
  var was = s.status;
  void sync() {
    if (s.status == SessionStatus.signedIn && was != SessionStatus.signedIn) Push.register(s.api);
    was = s.status;
  }

  s.addListener(sync);
  sync();
  void open(String link) => router.go(appPathFor(link) ?? '/alerts');
  final taps = Push.taps.listen(open);
  final live = Push.foreground.listen((_) => ref.read(bellProvider).refresh());
  Push.launchLink().then((l) {
    if (l != null) open(l);
  });
  ref.onDispose(() {
    s.removeListener(sync);
    unawaited(taps.cancel());
    unawaited(live.cancel());
  });
});
