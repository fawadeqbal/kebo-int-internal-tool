/// RFQ Desk phone versions.
///
/// One version, in pubspec.yaml: `version: <semver>+<build>`.
///   * semver is MAJOR.MINOR.PATCH, optionally `-alpha.N`, `-beta.N` or `-rc.N` (N 1–29).
///   * build (Android versionCode) is worked out from the semver, never typed by hand, so it
///     always grows with the version:
///       MAJOR * 1,000,000 + MINOR * 10,000 + PATCH * 100 + stage
///     where stage is alpha N (1–29), beta 30+N, rc 60+N, and 99 for the release itself.
///   * MINOR and PATCH stay under 100.
/// A release is the git tag `phone-v<semver>` on a commit whose pubspec says that version
/// and whose CHANGELOG.md has a `## <semver>` section (the release notes).
library;

class Version implements Comparable<Version> {
  const Version(this.major, this.minor, this.patch, {this.pre, this.preNumber});

  final int major;
  final int minor;
  final int patch;

  /// 'alpha', 'beta', 'rc' or null for a release.
  final String? pre;
  final int? preNumber;

  static final _re = RegExp(r'^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$');

  static Version parse(String s) {
    final m = _re.firstMatch(s.trim());
    if (m == null) {
      throw FormatException('Not a version: "$s" (use 3.1.0, 3.1.0-alpha.2, 3.1.0-beta.1 or 3.1.0-rc.1)');
    }
    final v = Version(
      int.parse(m[1]!),
      int.parse(m[2]!),
      int.parse(m[3]!),
      pre: m[4],
      preNumber: m[5] == null ? null : int.parse(m[5]!),
    );
    v.code; // validates ranges
    return v;
  }

  bool get isPrerelease => pre != null;

  /// The Android versionCode.
  int get code {
    if (minor > 99 || patch > 99) throw FormatException('MINOR and PATCH must be under 100: $this');
    final n = preNumber ?? 0;
    if (pre != null && (n < 1 || n > 29)) throw FormatException('A pre-release number must be 1–29: $this');
    final stage = switch (pre) {
      'alpha' => n,
      'beta' => 30 + n,
      'rc' => 60 + n,
      _ => 99,
    };
    return major * 1000000 + minor * 10000 + patch * 100 + stage;
  }

  Version bump(String part) => switch (part) {
    'major' => Version(major + 1, 0, 0),
    'minor' => Version(major, minor + 1, 0),
    'patch' => isPrerelease ? Version(major, minor, patch) : Version(major, minor, patch + 1),
    'alpha' || 'beta' || 'rc' => _nextPre(part),
    'release' => Version(major, minor, patch),
    _ => throw ArgumentError('Bump major, minor, patch, alpha, beta, rc or release (not "$part")'),
  };

  Version _nextPre(String stage) {
    if (pre == stage) return Version(major, minor, patch, pre: stage, preNumber: preNumber! + 1);
    // Moving forward (alpha → beta → rc) restarts at 1; from a release it opens the next patch.
    const order = ['alpha', 'beta', 'rc'];
    if (pre != null && order.indexOf(stage) > order.indexOf(pre!)) {
      return Version(major, minor, patch, pre: stage, preNumber: 1);
    }
    if (pre == null) return Version(major, minor, patch + 1, pre: stage, preNumber: 1);
    throw ArgumentError('Can not go back from $pre to $stage');
  }

  /// `version:` value for pubspec.yaml.
  String get pubspec => '$this+$code';

  @override
  String toString() => '$major.$minor.$patch${pre == null ? '' : '-$pre.$preNumber'}';

  @override
  int compareTo(Version other) => code.compareTo(other.code);

  @override
  bool operator ==(Object other) => other is Version && other.code == code && other.major == major;

  @override
  int get hashCode => code.hashCode;
}

final _pubspecLine = RegExp(r'^version:\s*(\S+)\s*$', multiLine: true);

/// Reads `version:` from pubspec.yaml text. Returns the version and the build number written there.
(Version, int) readPubspec(String pubspec) {
  final m = _pubspecLine.firstMatch(pubspec);
  if (m == null) throw const FormatException('pubspec.yaml has no version: line');
  final parts = m[1]!.split('+');
  if (parts.length != 2) throw FormatException('version must be <semver>+<build>, found ${m[1]}');
  return (Version.parse(parts[0]), int.parse(parts[1]));
}

String writePubspec(String pubspec, Version v) => pubspec.replaceFirst(_pubspecLine, 'version: ${v.pubspec}');

/// The text under `## <version>` in CHANGELOG.md, or null when there is no such section.
String? changelogSection(String changelog, Version v) {
  final lines = changelog.split('\n');
  final head = RegExp('^## ${RegExp.escape(v.toString())}(\\s|\$)');
  final start = lines.indexWhere(head.hasMatch);
  if (start < 0) return null;
  final end = lines.indexWhere((l) => l.startsWith('## '), start + 1);
  final body = lines.sublist(start + 1, end < 0 ? lines.length : end).join('\n').trim();
  return body;
}

/// Problems that stop a version from being released (empty when it is fine).
List<String> check(String pubspec, String changelog, {String? tag}) {
  final problems = <String>[];
  final (Version v, int build) = readPubspec(pubspec);
  if (build != v.code) {
    problems.add('Build number is $build but $v must be ${v.code}. Run `dart run tool/version.dart set $v`.');
  }
  final notes = changelogSection(changelog, v);
  if (notes == null) {
    problems.add('CHANGELOG.md has no "## $v" section.');
  } else if (notes.isEmpty || notes.contains('TODO')) {
    problems.add('The "## $v" section of CHANGELOG.md is empty or still says TODO.');
  }
  if (tag != null && tag != 'phone-v$v') {
    problems.add('Tag $tag does not match pubspec version $v (expected phone-v$v).');
  }
  return problems;
}
