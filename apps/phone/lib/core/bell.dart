import 'dart:async';

import 'package:flutter/foundation.dart';

import 'api.dart';
import 'json.dart';

/// The bell's unread count, the same on every tab. Read when signed in, every minute while
/// the app is open, and again after the alerts page marks things read.
class Bell extends ChangeNotifier {
  Bell(this.api);
  final Api api;
  int unread = 0;
  Timer? _timer;

  /// Off in tests: no timer outlives a test.
  static bool autoRefresh = true;

  void start() {
    _timer?.cancel();
    refresh();
    if (!autoRefresh) return;
    _timer = Timer.periodic(const Duration(minutes: 1), (_) => refresh());
  }

  void stop() {
    _timer?.cancel();
    unread = 0;
    notifyListeners();
  }

  Future<void> refresh() async {
    try {
      final j = await api.get('/api/notifications', query: {'unread': 'true', 'take': 1});
      set(j.integer('unread'));
    } on ApiException {
      // keep the last count; offline is shown in the header
    }
  }

  void set(int n) {
    if (n == unread) return;
    unread = n;
    notifyListeners();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }
}
