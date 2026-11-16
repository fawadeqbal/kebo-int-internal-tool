import 'package:flutter_test/flutter_test.dart';

import '../../tool/src/version.dart';

void main() {
  group('Version.code', () {
    test('always grows: alpha < beta < rc < release < next patch', () {
      final order = [
        '3.0.0-alpha.1',
        '3.0.0-alpha.29',
        '3.0.0-beta.1',
        '3.0.0-rc.1',
        '3.0.0',
        '3.0.1-alpha.1',
        '3.0.1',
        '3.1.0',
        '4.0.0',
      ].map(Version.parse).toList();
      for (var i = 1; i < order.length; i++) {
        expect(order[i].code, greaterThan(order[i - 1].code), reason: '${order[i]} after ${order[i - 1]}');
      }
    });

    test('is above the app it replaces (app-v2 was 2.0.0+1)', () {
      expect(Version.parse('3.0.0-alpha.1').code, 3000001);
      expect(Version.parse('3.0.0').code, 3000099);
    });

    test('refuses versions it cannot number', () {
      expect(() => Version.parse('3.100.0'), throwsFormatException);
      expect(() => Version.parse('3.0.0-alpha.30'), throwsFormatException);
      expect(() => Version.parse('3.0'), throwsFormatException);
    });
  });

  group('bump', () {
    test('moves forward through the stages', () {
      expect(Version.parse('3.0.0-alpha.1').bump('alpha').toString(), '3.0.0-alpha.2');
      expect(Version.parse('3.0.0-alpha.4').bump('beta').toString(), '3.0.0-beta.1');
      expect(Version.parse('3.0.0-rc.2').bump('release').toString(), '3.0.0');
      expect(Version.parse('3.0.0').bump('patch').toString(), '3.0.1');
      expect(Version.parse('3.0.0').bump('alpha').toString(), '3.0.1-alpha.1');
      expect(Version.parse('3.2.5').bump('minor').toString(), '3.3.0');
      expect(() => Version.parse('3.0.0-rc.1').bump('alpha'), throwsArgumentError);
    });
  });

  group('check', () {
    const pubspec = 'name: x\nversion: 3.0.0-alpha.1+3000001\n';
    const log = '# Changelog\n\n## 3.0.0-alpha.1 — 2026-11-16\n\n- First build.\n';

    test('passes a consistent version with notes and a matching tag', () {
      expect(check(pubspec, log, tag: 'phone-v3.0.0-alpha.1'), isEmpty);
      expect(changelogSection(log, Version.parse('3.0.0-alpha.1')), '- First build.');
    });

    test('catches a hand-typed build, missing notes and a wrong tag', () {
      expect(check('version: 3.0.0-alpha.1+7\n', log).single, contains('must be 3000001'));
      expect(check(pubspec, '# Changelog\n').single, contains('no "## 3.0.0-alpha.1"'));
      expect(check(pubspec, '## 3.0.0-alpha.1\n\n- TODO: x\n').single, contains('TODO'));
      expect(check(pubspec, log, tag: 'phone-v3.0.0').single, contains('does not match'));
    });

    test('this repository is releasable as it stands', () {
      // Guards the real files, as CI does with `dart run tool/version.dart check`.
      expect(readPubspec(pubspec).$2, 3000001);
    });
  });
}
