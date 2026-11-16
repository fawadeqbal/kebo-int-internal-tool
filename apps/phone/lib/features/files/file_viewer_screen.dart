import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pdfrx/pdfrx.dart';

import '../../core/api.dart';
import '../../core/download.dart';
import '../../core/links.dart';
import '../../core/providers.dart';
import '../../design/design.dart';

/// Opens a file of the system on the phone: PDFs page by page, photos with pinch to zoom.
/// Anything else (Word, Excel, video) opens on the web, where it can be downloaded.
class FileViewerScreen extends ConsumerStatefulWidget {
  const FileViewerScreen({super.key, required this.path, required this.name});

  /// The API path of the file's bytes, e.g. `/api/files/:id`.
  final String path;
  final String name;

  static bool canShow(String name) => RegExp(r'\.(pdf|jpe?g|png|webp|gif|heic)$', caseSensitive: false).hasMatch(name);

  @override
  ConsumerState<FileViewerScreen> createState() => _FileViewerScreenState();
}

class _FileViewerScreenState extends ConsumerState<FileViewerScreen> {
  Downloaded? _file;
  String? _error;
  double _progress = 0;
  int _pages = 0, _page = 1;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _error = null;
      _file = null;
    });
    try {
      final f = await ref
          .read(sessionProvider.notifier)
          .api
          .download(
            widget.path,
            progress: (p) {
              if (mounted) setState(() => _progress = p);
            },
          );
      if (mounted) setState(() => _file = f);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  bool get _isPdf => (_file?.type ?? '').contains('pdf') || widget.name.toLowerCase().endsWith('.pdf');

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    final f = _file;
    return Scaffold(
      backgroundColor: c.surfaceSunken,
      appBar: KTopBar(
        title: widget.name,
        leading: KTopBarLeading.close,
        actions: [
          KIconButton(
            KIcons.globe,
            label: 'Open on the web',
            onPressed: () =>
                openLink(context, ref.read(sessionProvider.notifier).api, widget.path.replaceFirst('/api', '')),
          ),
        ],
      ),
      body: switch ((f, _error)) {
        (_, final String e) => Padding(
          padding: const EdgeInsets.all(KSpace.s4),
          child: KBanner(
            e,
            tone: KTone.danger,
            title: "Couldn't open ${widget.name}",
            actionLabel: 'Try again',
            onAction: _load,
          ),
        ),
        (null, _) => Center(
          child: Padding(
            padding: const EdgeInsets.all(KSpace.s8),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('Opening ${widget.name}', style: KType.callout.copyWith(color: c.inkMuted)),
                const SizedBox(height: KSpace.s3),
                KProgress(value: _progress, label: 'Downloading'),
              ],
            ),
          ),
        ),
        (final Downloaded d, _) when _isPdf => Stack(
          children: [
            Semantics(
              label: 'PDF ${widget.name}${_pages > 0 ? ', $_pages pages' : ''}. Pinch to zoom.',
              child: PdfViewer.data(
                d.bytes,
                sourceName: widget.path,
                params: PdfViewerParams(
                  backgroundColor: c.surfaceSunken,
                  margin: KSpace.s3,
                  onViewerReady: (doc, _) => setState(() => _pages = doc.pages.length),
                  onPageChanged: (p) => setState(() => _page = p ?? _page),
                ),
              ),
            ),
            if (_pages > 1)
              Positioned(
                bottom: KSpace.s4,
                left: 0,
                right: 0,
                child: Center(child: KBadge('Page $_page of $_pages', tone: KTone.brand, showToneIcon: false)),
              ),
          ],
        ),
        (final Downloaded d, _) => InteractiveViewer(
          maxScale: 6,
          child: Center(
            child: Semantics(
              image: true,
              label: widget.name,
              child: Image.memory(
                d.bytes,
                errorBuilder: (_, _, _) => const KEmptyState(
                  icon: KIcons.file,
                  title: "Can't show this file here",
                  message: 'Open it on the web to download it.',
                ),
              ),
            ),
          ),
        ),
      },
    );
  }
}
