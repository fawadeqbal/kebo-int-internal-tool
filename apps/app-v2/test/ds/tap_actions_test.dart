import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// A label that hides its child's semantics must carry the tap itself, or a screen
/// reader can read the button but not press it.
void main() {
  test('every excludeSemantics button also has onTap', () {
    final offenders = <String>[];
    for (final f in Directory('lib').listSync(recursive: true).whereType<File>().where((f) => f.path.endsWith('.dart'))) {
      final src = f.readAsStringSync();
      for (final m in RegExp(r'Semantics\(([^;]*?)excludeSemantics: true([^;]*?)child:', dotAll: true).allMatches(src)) {
        final args = '${m.group(1)}${m.group(2)}';
        if (args.contains('button: true') && !args.contains('onTap:')) offenders.add('${f.path}: ${args.trim().split('\n').first}');
      }
    }
    expect(offenders, isEmpty);
  });
}
