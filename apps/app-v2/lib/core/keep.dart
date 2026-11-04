import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

/// Things kept on the phone between runs: answers read from the server and the writes waiting to
/// send. Text and bytes by name, in one folder per kind. Tests and the web keep them in memory.
abstract class KeepStore {
  Future<String?> read(String name);
  Future<void> write(String name, String text);
  Future<Uint8List?> readBytes(String name);
  Future<void> writeBytes(String name, Uint8List bytes);
  Future<void> delete(String name);

  /// Every name kept.
  Future<List<String>> names();

  /// Forget everything (signing out).
  Future<void> clear();

  /// A folder under the app's support folder on a phone; memory on the web.
  factory KeepStore.folder(String folder) => kIsWeb ? MemoryKeepStore() : _DirKeepStore(folder);
}

class MemoryKeepStore implements KeepStore {
  final _text = <String, String>{};
  final _bytes = <String, Uint8List>{};

  @override
  Future<String?> read(String name) async => _text[name];
  @override
  Future<void> write(String name, String text) async => _text[name] = text;
  @override
  Future<Uint8List?> readBytes(String name) async => _bytes[name];
  @override
  Future<void> writeBytes(String name, Uint8List bytes) async => _bytes[name] = bytes;
  @override
  Future<void> delete(String name) async {
    _text.remove(name);
    _bytes.remove(name);
  }

  @override
  Future<List<String>> names() async => [..._text.keys, ..._bytes.keys];
  @override
  Future<void> clear() async {
    _text.clear();
    _bytes.clear();
  }
}

class _DirKeepStore implements KeepStore {
  _DirKeepStore(this.folder);
  final String folder;
  Directory? _dir;

  Future<Directory> _get() async {
    if (_dir != null) return _dir!;
    final d = Directory('${(await getApplicationSupportDirectory()).path}/$folder');
    if (!d.existsSync()) d.createSync(recursive: true);
    return _dir = d;
  }

  Future<File> _file(String name) async => File('${(await _get()).path}/$name');

  @override
  Future<String?> read(String name) async {
    final f = await _file(name);
    return f.existsSync() ? f.readAsString() : null;
  }

  @override
  Future<void> write(String name, String text) async {
    // Whole or nothing: a half-written file is never read back.
    final f = await _file(name);
    final tmp = File('${f.path}.part');
    await tmp.writeAsString(text, flush: true);
    await tmp.rename(f.path);
  }

  @override
  Future<Uint8List?> readBytes(String name) async {
    final f = await _file(name);
    return f.existsSync() ? f.readAsBytes() : null;
  }

  @override
  Future<void> writeBytes(String name, Uint8List bytes) async => (await _file(name)).writeAsBytes(bytes, flush: true);

  @override
  Future<void> delete(String name) async {
    final f = await _file(name);
    if (f.existsSync()) await f.delete();
  }

  @override
  Future<List<String>> names() async =>
      [for (final e in (await _get()).listSync()) if (e is File && !e.path.endsWith('.part')) e.uri.pathSegments.last];

  @override
  Future<void> clear() async {
    final d = await _get();
    if (d.existsSync()) await d.delete(recursive: true);
    _dir = null;
  }
}

/// One answer kept from the server, and when it came.
class Kept {
  const Kept(this.data, this.at);
  final Object? data;
  final DateTime at;
}

/// What the server answered to each GET, kept by URL for this sign-in. Read when there is no signal.
class ReadCache {
  ReadCache(this.store);
  final KeepStore store;

  /// Who is signed in: another person's (or company's) answers are never shown.
  String owner = '';

  // File names: short and safe whatever the URL holds.
  String _name(String url) => 'r${_hash('$owner|$url')}.json';

  static String _hash(String s) {
    // FNV-1a, 64-bit, two halves: plenty for file names.
    var a = 0x811c9dc5, b = 0x01000193;
    for (final c in utf8.encode(s)) {
      a = ((a ^ c) * 0x01000193) & 0xffffffff;
      b = ((b ^ c) * 0x811c9dc5 + 7) & 0xffffffff;
    }
    return '${a.toRadixString(16).padLeft(8, '0')}${b.toRadixString(16).padLeft(8, '0')}';
  }

  Future<void> put(String url, Object? data, {DateTime? at}) =>
      store.write(_name(url), jsonEncode({'url': url, 'at': (at ?? DateTime.now()).toIso8601String(), 'data': data}));

  Future<Kept?> get(String url) async {
    try {
      final s = await store.read(_name(url));
      if (s == null) return null;
      final j = jsonDecode(s) as Map<String, dynamic>;
      if (j['url'] != url) return null;
      return Kept(j['data'], DateTime.parse(j['at'] as String));
    } catch (_) {
      return null; // a broken file is as good as none
    }
  }

  Future<void> clear() => store.clear();
}
