import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'json.dart';
import 'session.dart';

/// Bumped after every change (save, status, payment…). Lists and detail screens
/// watch it, so everything on screen shows the new state without manual refresh.
class DataVersion extends Notifier<int> {
  @override
  int build() => 0;
  void bump() => state++;
}

final dataVersionProvider = NotifierProvider<DataVersion, int>(DataVersion.new);

/// GET an API path, refreshed whenever data changes.
final getProvider = FutureProvider.autoDispose.family<Json, String>((ref, path) async {
  ref.watch(dataVersionProvider);
  return ref.read(apiProvider).get(path);
});

extension Mutate on WidgetRef {
  /// Run a change, then refresh what is on screen.
  Future<Json> mutate(Future<Json> Function() action) async {
    final res = await action();
    read(dataVersionProvider.notifier).bump();
    return res;
  }
}
