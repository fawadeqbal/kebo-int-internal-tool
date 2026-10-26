import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Bumped after every change (note, stage, step…). Lists and detail screens
/// watch it, so everything on screen shows the new state without manual refresh.
class DataVersion extends Notifier<int> {
  @override
  int build() => 0;
  void bump() => state++;
}

final dataVersionProvider = NotifierProvider<DataVersion, int>(DataVersion.new);

extension Mutate on WidgetRef {
  /// Run a change, then refresh what is on screen.
  Future<T> mutate<T>(Future<T> Function() action) async {
    final res = await action();
    read(dataVersionProvider.notifier).bump();
    return res;
  }
}
