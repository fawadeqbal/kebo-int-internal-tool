import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';
import 'package:pdfrx/pdfrx.dart';
import 'package:share_plus/share_plus.dart';

import '../core/format.dart' as f;
import '../core/repository.dart';
import '../core/session.dart';
import 'kit.dart';

/// What the in-app viewer can show.
enum ViewKind { pdf, image, other }

ViewKind viewKind(String mime, String fileName) {
  final m = mime.toLowerCase();
  final ext = fileName.toLowerCase().split('.').last;
  if (m == 'application/pdf' || ext == 'pdf') return ViewKind.pdf;
  if (m.startsWith('image/') && !m.contains('svg') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].contains(ext)) return ViewKind.image;
  return ViewKind.other;
}

String _mimeFor(String fileName, String mime) {
  if (mime.isNotEmpty && mime != 'application/octet-stream') return mime;
  return switch (fileName.toLowerCase().split('.').last) {
    'pdf' => 'application/pdf',
    'png' => 'image/png',
    'jpg' || 'jpeg' => 'image/jpeg',
    'webp' => 'image/webp',
    'gif' => 'image/gif',
    _ => 'application/octet-stream',
  };
}

/* ---------------------------------------------------------------- actions */

/// Save to the phone: Android/iOS show their "Save to…" screen (Downloads, Drive…); no storage permission needed.
Future<void> saveToPhone(BuildContext context, Uint8List bytes, String fileName, String mime) async {
  try {
    final uri = await FilePicker.saveFile(fileName: fileName, bytes: bytes, mimeType: _mimeFor(fileName, mime), dialogTitle: 'Save $fileName');
    if (uri != null && context.mounted) toast(context, 'Saved $fileName');
  } catch (e) {
    if (context.mounted) toast(context, 'Could not save: $e', error: true);
  }
}

Future<void> shareFile(Uint8List bytes, String fileName, String mime) =>
    SharePlus.instance.share(ShareParams(files: [XFile.fromData(bytes, name: fileName, mimeType: _mimeFor(fileName, mime))], fileNameOverrides: [fileName], subject: fileName));

/// Hand the file to another app on the phone (PDF reader, Excel, AutoCAD viewer…).
Future<void> openWithOtherApp(BuildContext context, Uint8List bytes, String fileName, String mime) async {
  try {
    final dir = await getTemporaryDirectory();
    final safe = fileName.replaceAll(RegExp(r'[^\w.\- ]+'), '_');
    final path = '${dir.path}/$safe';
    await XFile.fromData(bytes, name: safe).saveTo(path);
    final res = await OpenFilex.open(path, type: _mimeFor(fileName, mime));
    if (res.type != ResultType.done && context.mounted) toast(context, 'No app on this phone opens this kind of file. Save or share it instead.', error: true);
  } catch (e) {
    if (context.mounted) toast(context, e.toString(), error: true);
  }
}

/// Open any file or PDF from the server in the in-app viewer.
Future<void> openViewer(BuildContext context, {required String path, required String fileName, String mime = '', num? size}) {
  return Navigator.of(context, rootNavigator: true).push(MaterialPageRoute(
    builder: (_) => FileViewerScreen(path: path, fileName: fileName, mime: mime, size: size),
  ));
}

/// A document's PDF made by the web app (`<server>/pdf/<kind>/<id>`, see [KeboRepository.pdfPath]),
/// downloaded with the app's session, kept in the phone's temporary folder and shown in the
/// in-app viewer with Share (WhatsApp, email…) and Open in another app.
Future<void> openPdf(BuildContext context, {required String kind, required String id, required String fileName}) {
  return Navigator.of(context, rootNavigator: true).push(MaterialPageRoute(
    builder: (_) => FileViewerScreen(path: KeboRepository.pdfPath(kind, id), fileName: fileName, mime: 'application/pdf', pdf: (kind: kind, id: id)),
  ));
}

/// Keep a downloaded PDF in the temporary folder (the phone clears it when space is needed).
Future<String?> keepInTemp(Uint8List bytes, String fileName) async {
  if (kIsWeb) return null;
  try {
    final dir = await getTemporaryDirectory();
    final path = '${dir.path}/${fileName.replaceAll(RegExp(r'[^\w.\- ]+'), '_')}';
    await XFile.fromData(bytes, name: fileName).saveTo(path);
    return path;
  } catch (_) {
    return null;
  }
}

/// A deal's file (GET /api/files/:id).
Future<void> openFile(BuildContext context, WidgetRef ref, {required String id, required String fileName, String mime = '', num? size}) =>
    openViewer(context, path: KeboRepository.filePath(id), fileName: fileName, mime: mime, size: size);

/// Save / share an attachment straight from a list, without opening it.
Future<void> quickFileAction(BuildContext context, WidgetRef ref, {required String path, required String fileName, String mime = '', required String action}) async {
  toast(context, 'Downloading $fileName…');
  try {
    final bytes = await ref.read(apiProvider).getBytes(path);
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).hideCurrentSnackBar();
    switch (action) {
      case 'save':
        await saveToPhone(context, bytes, fileName, mime);
      case 'share':
        await shareFile(bytes, fileName, mime);
      case 'open':
        await openWithOtherApp(context, bytes, fileName, mime);
    }
  } catch (e) {
    if (context.mounted) toast(context, e.toString(), error: true);
  }
}

/* ---------------------------------------------------------------- viewer */

class FileViewerScreen extends ConsumerStatefulWidget {
  const FileViewerScreen({super.key, required this.path, required this.fileName, this.mime = '', this.size, this.pdf});
  final String path;
  final String fileName;
  final String mime;
  final num? size;

  /// A PDF made by the web app: downloaded with [KeboRepository.pdf] instead of [path].
  final ({String kind, String id})? pdf;
  @override
  ConsumerState<FileViewerScreen> createState() => _FileViewerScreenState();
}

class _FileViewerScreenState extends ConsumerState<FileViewerScreen> {
  Uint8List? _bytes;
  Object? _error;
  double _progress = 0;
  int? _page;
  int? _pages;
  final _zoom = TransformationController();
  TapDownDetails? _tap;

  late final ViewKind _kind = viewKind(widget.mime, widget.fileName);

  /// The server's name for a PDF, once it has sent one.
  late String _name = widget.fileName;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _zoom.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _error = null;
      _bytes = null;
      _progress = 0;
    });
    void progress(double p) {
      if (mounted) setState(() => _progress = p);
    }

    try {
      final pdf = widget.pdf;
      if (pdf != null) {
        final file = await ref.read(repoProvider).pdf(pdf.kind, pdf.id, onProgress: progress);
        final name = file.fileName ?? widget.fileName;
        await keepInTemp(file.bytes, name);
        if (mounted) {
          setState(() {
            _name = name;
            _bytes = file.bytes;
          });
        }
        return;
      }
      final bytes = await ref.read(apiProvider).getBytes(widget.path, onProgress: progress);
      if (mounted) setState(() => _bytes = bytes);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  void _doubleTapZoom() {
    if (_zoom.value != Matrix4.identity()) {
      _zoom.value = Matrix4.identity();
      return;
    }
    final p = _tap?.localPosition ?? Offset.zero;
    const scale = 2.5;
    _zoom.value = Matrix4.identity()
      ..translateByDouble(-p.dx * (scale - 1), -p.dy * (scale - 1), 0, 1)
      ..scaleByDouble(scale, scale, 1, 1);
  }

  @override
  Widget build(BuildContext context) {
    final bytes = _bytes;
    final dark = _kind == ViewKind.image;
    final fg = dark ? Colors.white : null;
    return Scaffold(
      backgroundColor: dark ? Colors.black : context.c.surface3,
      appBar: AppBar(
        backgroundColor: dark ? Colors.black : null,
        foregroundColor: fg,
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(_name, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 15.5, fontWeight: FontWeight.w600, color: fg)),
          if (_kind == ViewKind.pdf && _pages != null)
            Text('Page ${_page ?? 1} of $_pages', style: context.t.bodySmall!.copyWith(color: dark ? Colors.white70 : null))
          else if (widget.size != null)
            Text(f.fileSize(widget.size!), style: context.t.bodySmall!.copyWith(color: dark ? Colors.white70 : null)),
        ]),
        actions: bytes == null
            ? null
            : [
                IconButton(tooltip: 'Save to phone', icon: const Icon(Icons.download_rounded), onPressed: () => saveToPhone(context, bytes, _name, widget.mime)),
                IconButton(tooltip: 'Share', icon: const Icon(Icons.ios_share_rounded), onPressed: () => shareFile(bytes, _name, widget.mime)),
                if (!kIsWeb)
                  PopupMenuButton<String>(
                    iconColor: fg,
                    onSelected: (_) => openWithOtherApp(context, bytes, _name, widget.mime),
                    itemBuilder: (_) => const [PopupMenuItem(value: 'open', child: ListTile(dense: true, leading: Icon(Icons.open_in_new_rounded), title: Text('Open in another app')))],
                  ),
              ],
      ),
      body: _error != null
          ? ErrorState(_error!, onRetry: _load)
          : bytes == null
              ? Center(
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    SizedBox(width: 160, child: LinearProgressIndicator(value: _progress > 0 ? _progress : null)),
                    gap12,
                    Text(_progress > 0 ? 'Downloading… ${(_progress * 100).round()}%' : 'Opening…', style: context.t.bodySmall!.copyWith(color: dark ? Colors.white70 : null)),
                  ]),
                )
              : switch (_kind) {
                  ViewKind.pdf => PdfViewer.data(
                      bytes,
                      sourceName: _name,
                      params: PdfViewerParams(
                        backgroundColor: context.c.surface3,
                        margin: 10,
                        pageDropShadow: const BoxShadow(color: Color(0x33000000), blurRadius: 6, offset: Offset(0, 2)),
                        onViewerReady: (doc, _) => setState(() => _pages = doc.pages.length),
                        onPageChanged: (p) => setState(() => _page = p),
                        errorBannerBuilder: (context, error, stack, ref) => ErrorState('This PDF could not be shown: $error'),
                      ),
                    ),
                  ViewKind.image => GestureDetector(
                      onDoubleTapDown: (d) => _tap = d,
                      onDoubleTap: _doubleTapZoom,
                      child: InteractiveViewer(
                        transformationController: _zoom,
                        minScale: 1,
                        maxScale: 8,
                        child: SizedBox.expand(
                          child: Image.memory(bytes, fit: BoxFit.contain, errorBuilder: (_, _, _) => const Center(child: Text('This image could not be shown.', style: TextStyle(color: Colors.white70)))),
                        ),
                      ),
                    ),
                  ViewKind.other => _OtherFile(name: _name, size: bytes.length, onSave: () => saveToPhone(context, bytes, _name, widget.mime), onShare: () => shareFile(bytes, _name, widget.mime), onOpen: kIsWeb ? null : () => openWithOtherApp(context, bytes, _name, widget.mime)),
                },
    );
  }
}

class _OtherFile extends StatelessWidget {
  const _OtherFile({required this.name, required this.size, required this.onSave, required this.onShare, this.onOpen});
  final String name;
  final int size;
  final VoidCallback onSave, onShare;
  final VoidCallback? onOpen;
  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Card(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Icon(Icons.insert_drive_file_outlined, size: 44, color: context.c.primary),
              gap12,
              Text(name, textAlign: TextAlign.center, style: context.t.titleSmall),
              Text(f.fileSize(size), textAlign: TextAlign.center, style: context.t.bodySmall),
              gap8,
              Text('This kind of file opens in another app (Excel, a CAD viewer, a ZIP tool…).', textAlign: TextAlign.center, style: context.t.bodySmall),
              gap16,
              if (onOpen != null) ...[FilledButton.icon(onPressed: onOpen, icon: const Icon(Icons.open_in_new_rounded, size: 18), label: const Text('Open in another app')), gap8],
              OutlinedButton.icon(onPressed: onSave, icon: const Icon(Icons.download_rounded, size: 18), label: const Text('Save to phone')),
              gap8,
              OutlinedButton.icon(onPressed: onShare, icon: const Icon(Icons.ios_share_rounded, size: 18), label: const Text('Share')),
            ]),
          ),
        ),
      ),
    );
  }
}
