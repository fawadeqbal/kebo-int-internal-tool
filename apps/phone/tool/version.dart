// Version control for the RFQ Desk phone app. See tool/src/version.dart for the rules.
//
//   dart run tool/version.dart                 print the version, build and tag
//   dart run tool/version.dart bump <part>     major | minor | patch | alpha | beta | rc | release
//   dart run tool/version.dart set 3.1.0       set an exact version
//   dart run tool/version.dart check [--tag phone-v3.1.0]   CI: fail when the version can't be released
//   dart run tool/version.dart notes           print this version's CHANGELOG section (release notes)
import 'dart:io';

import 'src/version.dart';

void main(List<String> args) {
  final pubspecFile = File('pubspec.yaml');
  final changelogFile = File('CHANGELOG.md');
  final pubspec = pubspecFile.readAsStringSync();
  final (current, _) = readPubspec(pubspec);
  final cmd = args.isEmpty ? 'show' : args.first;

  switch (cmd) {
    case 'show':
      stdout.writeln('version $current\nbuild   ${current.code}\ntag     phone-v$current');
    case 'bump' || 'set':
      if (args.length < 2) _fail('Say what to ${cmd == 'bump' ? 'bump' : 'set'}.');
      final next = cmd == 'bump' ? current.bump(args[1]) : Version.parse(args[1]);
      if (next.code <= current.code) _fail('$next (${next.code}) is not newer than $current (${current.code}).');
      pubspecFile.writeAsStringSync(writePubspec(pubspec, next));
      final log = changelogFile.existsSync() ? changelogFile.readAsStringSync() : '# Changelog\n';
      if (changelogSection(log, next) == null) {
        final today = DateTime.now().toIso8601String().substring(0, 10);
        final i = log.indexOf('\n## ');
        final entry = '\n## $next — $today\n\n- TODO: what changed, in plain words.\n';
        changelogFile.writeAsStringSync(i < 0 ? '$log$entry' : '${log.substring(0, i)}$entry${log.substring(i)}');
      }
      stdout.writeln(
        '$current → $next (build ${next.code}). Write the CHANGELOG.md entry, commit, then tag phone-v$next.',
      );
    case 'check':
      final tagIndex = args.indexOf('--tag');
      final tag = tagIndex >= 0 && tagIndex + 1 < args.length ? args[tagIndex + 1] : null;
      final problems = check(pubspec, changelogFile.existsSync() ? changelogFile.readAsStringSync() : '', tag: tag);
      if (problems.isNotEmpty) {
        for (final p in problems) {
          stderr.writeln('✗ $p');
        }
        exit(1);
      }
      stdout.writeln('✓ $current (build ${current.code}) can be released${tag == null ? '' : ' as $tag'}.');
    case 'notes':
      stdout.writeln(changelogSection(changelogFile.readAsStringSync(), current) ?? '');
    default:
      _fail('Unknown command "$cmd".');
  }
}

Never _fail(String msg) {
  stderr.writeln(msg);
  exit(2);
}
