import 'package:flutter/widgets.dart';

import 'api.dart';
import 'files.dart';
import 'session.dart';

/// Gives every screen the API and the session: `context.api`, `context.session`.
class AppScope extends InheritedNotifier<Session> {
  const AppScope({super.key, required Session session, required super.child}) : super(notifier: session);

  static Session of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<AppScope>();
    assert(scope != null, 'No AppScope above this widget');
    return scope!.notifier!;
  }
}

extension ScopeContext on BuildContext {
  Session get session => AppScope.of(this);
  Api get api => AppScope.of(this).api;
  FileStore get files => AppScope.of(this).files;

  /// Whether the signed-in person may [perm]; null means everyone may.
  bool can(String? perm) => AppScope.of(this).can(perm);
}
