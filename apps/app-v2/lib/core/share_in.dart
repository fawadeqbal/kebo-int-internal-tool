import 'dart:async';
import 'dart:io' show File;

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:receive_sharing_intent/receive_sharing_intent.dart';

/// The kinds of file the server takes (apps/api storage.service.ts ALLOWED_EXTENSIONS).
const uploadExtensions = {
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'txt', 'rtf', //
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', //
  'dwg', 'dxf', 'step', 'stp', 'iges', 'igs', 'stl', 'zip', 'rar', '7z',
};

String _ext(String name) => name.contains('.') ? name.split('.').last.toLowerCase() : '';

/// One file shared into the app, read from the phone.
class SharedFile {
  const SharedFile(this.name, this.bytes);
  final String name;
  final Uint8List bytes;

  bool get isImage => const {'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'}.contains(_ext(name));
}

/// What came through Share → RFQ Desk: the words, the files, and what could not be taken (with why).
class Shared {
  const Shared({this.text, this.files = const [], this.refused = const []});
  final String? text;
  final List<SharedFile> files;
  final List<String> refused;

  bool get isEmpty => (text ?? '').trim().isEmpty && files.isEmpty && refused.isEmpty;
}

/// Where shares come from: the phone's share sheet, or a fake one in tests.
abstract class ShareSource {
  /// What the app was opened with, if it was opened by a share.
  Future<Shared?> initial();

  /// Shares that arrive while the app is open.
  Stream<Shared> get incoming;

  /// The share was taken: do not give it again.
  Future<void> reset();
}

/// Android's share sheet, through receive_sharing_intent and MainActivity's "rfqdesk/share" channel
/// (the words that come with files, which the plugin drops).
class DeviceShares implements ShareSource {
  DeviceShares();

  static const _channel = MethodChannel('rfqdesk/share');

  @override
  Future<Shared?> initial() async => read(await ReceiveSharingIntent.instance.getInitialMedia());

  @override
  Stream<Shared> get incoming =>
      ReceiveSharingIntent.instance.getMediaStream().asyncMap(read).where((s) => s != null).cast<Shared>();

  @override
  Future<void> reset() async {
    await ReceiveSharingIntent.instance.reset();
    await _channel.invokeMethod<void>('reset').catchError((_) {});
  }

  Future<String?> _text() async {
    try {
      return await _channel.invokeMethod<String>('text');
    } on Exception {
      return null; // no channel (tests, other platforms): the plugin's text is used
    }
  }

  /// The plugin's list as a [Shared]: files read into memory, the kinds the server refuses left out.
  /// A link (rfqdesk://…) is not a share: the router opens it.
  @visibleForTesting
  Future<Shared?> read(List<SharedMediaFile> media) async {
    if (media.every((m) => m.type == SharedMediaType.url)) return null;
    final texts = <String>[], files = <SharedFile>[], refused = <String>[];
    for (final m in media) {
      if (m.type == SharedMediaType.url) continue;
      // A .txt or .csv file comes as "text" with its path.
      final isFile = m.type != SharedMediaType.text || (m.path.startsWith('/') && !m.path.contains('\n') && File(m.path).existsSync());
      if (!isFile) {
        texts.add(m.path);
        continue;
      }
      final name = m.path.split('/').last;
      if (!uploadExtensions.contains(_ext(name))) {
        refused.add('$name: this kind of file cannot be attached');
        continue;
      }
      try {
        files.add(SharedFile(name, await File(m.path).readAsBytes()));
      } on Exception {
        refused.add('$name: could not be read');
      }
    }
    final text = await _text() ?? (texts.isEmpty ? null : texts.join('\n\n'));
    final s = Shared(text: text, files: files, refused: refused);
    return s.isEmpty ? null : s;
  }
}

/// Holds a share until a new inquiry takes it: across sign-in, and while the app starts.
class ShareInbox extends ChangeNotifier {
  ShareInbox(this.source);
  final ShareSource source;
  StreamSubscription<Shared>? _sub;
  Shared? _pending;

  Shared? get pending => _pending;

  Future<void> start() async {
    _sub = source.incoming.listen(_put, onError: (Object _) {});
    try {
      final first = await source.initial();
      if (first != null) _put(first);
    } on Exception {
      // Nothing shared, or the share could not be read.
    }
  }

  void _put(Shared s) {
    if (s.isEmpty) return;
    _pending = s;
    notifyListeners();
  }

  /// The share, once.
  Shared? take() {
    final s = _pending;
    _pending = null;
    if (s != null) source.reset().catchError((_) {});
    return s;
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }
}
