import 'dart:convert';
import 'dart:io' show Directory, File;

import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import 'api.dart';

/// A file on the server: an uploaded file (`/api/files/<id>`) or a paper the
/// system makes (`/pdf/<kind>/<order id>`). [path] is relative to the server.
class RemoteFile {
  const RemoteFile({required this.path, required this.name, this.type, this.size, this.note, this.internal = false});

  final String path;
  final String name;

  /// The MIME type when the server said; otherwise guessed from [name].
  final String? type;
  final int? size;

  /// A line under the name: "Proforma invoice · KEB261103LP09".
  final String? note;

  /// For us only (costs, margin): the viewer says so on top.
  final bool internal;

  String get mime => type ?? mimeFor(name);
  FileKind get kind => kindOf(mime, name);
}

enum FileKind { pdf, image, video, text, other }

const _ext = {
  'pdf': 'application/pdf', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'webp': 'image/webp',
  'gif': 'image/gif', 'heic': 'image/heic', 'heif': 'image/heif', 'mp4': 'video/mp4', 'mov': 'video/quicktime',
  'txt': 'text/plain', 'csv': 'text/csv', 'doc': 'application/msword', 'zip': 'application/zip',
  'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'xls': 'application/vnd.ms-excel', 'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

String mimeFor(String name) => _ext[name.split('.').last.toLowerCase()] ?? 'application/octet-stream';

FileKind kindOf(String mime, String name) {
  if (mime == 'application/pdf') return FileKind.pdf;
  // HEIC is a photo, but phones other than iPhones often cannot draw it: open it elsewhere.
  if (mime.startsWith('image/') && !mime.contains('hei')) return FileKind.image;
  if (mime.startsWith('video/')) return FileKind.video;
  if (mime.startsWith('text/')) return FileKind.text;
  return FileKind.other;
}

/// "1.2 MB".
String fileSize(int? bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return '$bytes B';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(0)} KB';
  return '${(bytes / 1024 / 1024).toStringAsFixed(1)} MB';
}

/// A file in hand: its bytes, the name the server gave, and where it is kept on the phone.
class LoadedFile {
  const LoadedFile(this.bytes, {required this.name, required this.mime, this.localPath, this.savedAt, this.fromCopy = false});
  final Uint8List bytes;
  final String name, mime;
  final String? localPath;

  /// When this copy was downloaded.
  final DateTime? savedAt;

  /// True when the server could not be reached and the kept copy is shown.
  final bool fromCopy;

  FileKind get kind => kindOf(mime, name);
}

/// Downloads files with the session, keeps a copy on the phone so they open
/// without a connection, and saves, shares or opens them in another app.
class FileStore {
  FileStore(this.api);
  final Api api;

  final _memory = <String, LoadedFile>{};

  /// Fresh from the server; the kept copy when offline. Throws [ApiException] when neither.
  Future<LoadedFile> load(RemoteFile f, {void Function(double)? progress}) async {
    try {
      final res = await api.download(f.path, progress: progress);
      final name = res.fileName ?? f.name;
      final mime = (res.type == null || res.type == 'application/octet-stream') ? (f.type ?? mimeFor(name)) : res.type!;
      final file = LoadedFile(res.bytes, name: name, mime: mime, savedAt: DateTime.now(), localPath: await _keep(f.path, res.bytes, name, mime));
      _memory[f.path] = file;
      return file;
    } on ApiException catch (e) {
      if (!e.offline) rethrow;
      final copy = _memory[f.path] ?? await _kept(f.path);
      if (copy == null) rethrow;
      return LoadedFile(copy.bytes, name: copy.name, mime: copy.mime, localPath: copy.localPath, savedAt: copy.savedAt, fromCopy: true);
    }
  }

  /// The phone's "Save to…" dialog. True when saved.
  Future<bool> saveToPhone(LoadedFile f) async =>
      await FilePicker.saveFile(fileName: f.name, bytes: f.bytes, mimeType: f.mime, dialogTitle: 'Save ${f.name}') != null || kIsWeb;

  /// The phone's share sheet (WhatsApp, email, WeChat…).
  /// [text] goes with the file (WhatsApp shows it as the caption; email as the body).
  Future<bool> share(LoadedFile f, {String? text, String? subject}) async {
    final r = await SharePlus.instance.share(ShareParams(
      files: [XFile.fromData(f.bytes, name: f.name, mimeType: f.mime)],
      fileNameOverrides: [f.name],
      subject: subject ?? f.name,
      text: text,
    ));
    return r.status == ShareResultStatus.success || r.status == ShareResultStatus.unavailable;
  }

  /// Another app on the phone that reads this kind of file. Null when it opened; else why not.
  Future<String?> openElsewhere(LoadedFile f) async {
    if (kIsWeb || f.localPath == null) return 'Save the file first, then open it from your files.';
    final r = await OpenFilex.open(f.localPath!, type: f.mime);
    return r.type == ResultType.done ? null : 'No app on this phone opens ${f.name.split('.').last.toUpperCase()} files.';
  }

  // ------------------------------------------------------------ the kept copy

  Future<Directory?> _dir() async {
    if (kIsWeb) return null;
    final d = Directory('${(await getApplicationCacheDirectory()).path}/files');
    if (!d.existsSync()) d.createSync(recursive: true);
    return d;
  }

  static String _key(String path) => base64Url.encode(utf8.encode(path)).replaceAll('=', '');

  Future<String?> _keep(String path, Uint8List bytes, String name, String mime) async {
    try {
      final d = await _dir();
      if (d == null) return null;
      final folder = Directory('${d.path}/${_key(path)}')..createSync(recursive: true);
      for (final old in folder.listSync()) {
        old.deleteSync();
      }
      final file = File('${folder.path}/$name');
      await file.writeAsBytes(bytes, flush: true);
      await File('${folder.path}/.meta').writeAsString(jsonEncode({'mime': mime, 'at': DateTime.now().toIso8601String()}));
      return file.path;
    } catch (_) {
      return null; // A full phone must not stop the file from showing.
    }
  }

  Future<LoadedFile?> _kept(String path) async {
    try {
      final d = await _dir();
      if (d == null) return null;
      final folder = Directory('${d.path}/${_key(path)}');
      if (!folder.existsSync()) return null;
      final meta = jsonDecode(await File('${folder.path}/.meta').readAsString()) as Map<String, dynamic>;
      final file = folder.listSync().whereType<File>().firstWhere((f) => !f.path.endsWith('/.meta'));
      return LoadedFile(await file.readAsBytes(),
          name: file.uri.pathSegments.last,
          mime: meta['mime'] as String,
          localPath: file.path,
          savedAt: DateTime.tryParse(meta['at'] as String));
    } catch (_) {
      return null;
    }
  }
}

/// What [Api.download] returns.
class Downloaded {
  const Downloaded(this.bytes, {this.fileName, this.type});
  final Uint8List bytes;
  final String? fileName, type;
}

/// "attachment; filename*=UTF-8''Sales%20contract.pdf" → "Sales contract.pdf".
String? fileNameFrom(String? disposition) {
  if (disposition == null) return null;
  final star = RegExp(r"filename\*=UTF-8''([^;]+)", caseSensitive: false).firstMatch(disposition);
  if (star != null) return Uri.decodeComponent(star.group(1)!.trim());
  final plain = RegExp(r'filename="?([^";]+)"?', caseSensitive: false).firstMatch(disposition);
  return plain?.group(1)?.trim();
}
