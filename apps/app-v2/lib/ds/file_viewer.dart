import 'dart:convert';
import 'dart:io' show File;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart' hide Badge;
import 'package:pdfrx/pdfrx.dart';
import 'package:video_player/video_player.dart';

import '../core/api.dart';
import '../core/files.dart';
import '../core/scope.dart';
import 'format.dart';
import 'theme.dart';
import 'tone.dart';
import 'widgets.dart';

/// One more way to open a file, e.g. "Internal copy" of a proforma.
class FileVariant {
  const FileVariant(this.label, this.file);
  final String label;
  final RemoteFile file;
}

/// Opens [file] full screen inside the app: PDFs with pages and zoom, photos
/// with zoom, videos, text. Share, Save to phone and Open in another app on every file.
/// [onShared] is told "share" or "download" (e.g. to note it in the order's history).
Future<void> openFile(BuildContext context, RemoteFile file, {List<FileVariant> variants = const [], void Function(String via)? onShared}) =>
    Navigator.of(context, rootNavigator: true).push(MaterialPageRoute<void>(
      builder: (_) => FileViewer(file: file, variants: variants, onShared: onShared),
    ));

class FileViewer extends StatefulWidget {
  const FileViewer({super.key, required this.file, this.variants = const [], this.onShared});
  final RemoteFile file;
  final List<FileVariant> variants;
  final void Function(String via)? onShared;

  @override
  State<FileViewer> createState() => _FileViewerState();
}

class _FileViewerState extends State<FileViewer> {
  late RemoteFile current = widget.file;
  LoadedFile? file;
  String? error;
  double? progress;
  int page = 1, pages = 0;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (file == null && error == null && progress == null) _load();
  }

  Future<void> _load() async {
    setState(() {
      error = null;
      file = null;
      progress = 0;
      page = 1;
      pages = 0;
    });
    try {
      final f = await context.files.load(current, progress: (p) {
        if (mounted) setState(() => progress = p);
      });
      if (mounted) setState(() => file = f);
    } on ApiException catch (e) {
      if (mounted) setState(() => error = e.message);
    }
  }

  Future<void> _share() async {
    final f = file!;
    if (await context.files.share(f)) widget.onShared?.call('share');
  }

  Future<void> _save() async {
    final f = file!;
    final ok = await context.files.saveToPhone(f);
    if (!mounted) return;
    if (ok) {
      widget.onShared?.call('download');
      toast(context, kIsWeb ? 'Downloaded ${f.name}' : 'Saved ${f.name}');
    }
  }

  Future<void> _elsewhere() async {
    final why = await context.files.openElsewhere(file!);
    if (why != null && mounted) toast(context, why);
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final f = file;
    final title = f?.name ?? current.name;
    final details = joinParts([
      current.note,
      if (f != null) fileSize(f.bytes.length) else fileSize(current.size),
      if (pages > 1) 'page $page of $pages',
    ]);
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(icon: const Icon(Icons.close), tooltip: 'Close', onPressed: () => Navigator.pop(context)),
        titleSpacing: 0,
        title: Semantics(
          header: true,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: context.text.titleMedium, maxLines: 1, overflow: TextOverflow.ellipsis),
            if (details.isNotEmpty) Text(details, style: context.text.bodySmall?.copyWith(color: c.text2), maxLines: 1),
          ]),
        ),
        actions: [
          if (f != null) IconButton(icon: const Icon(Icons.ios_share), tooltip: 'Share', onPressed: _share),
          if (f != null)
            PopupMenuButton<String>(
              tooltip: 'More actions',
              icon: const Icon(Icons.more_horiz),
              onSelected: (v) {
                switch (v) {
                  case 'save':
                    _save();
                  case 'open':
                    _elsewhere();
                  case 'reload':
                    _load();
                  default:
                    // "v:-1" is the customer copy, "v:<n>" the n-th variant.
                    final n = int.parse(v.substring(2));
                    current = n < 0 ? widget.file : widget.variants[n].file;
                    _load();
                }
              },
              itemBuilder: (_) => [
                PopupMenuItem(value: 'save', child: Text(kIsWeb ? 'Download' : 'Save to phone')),
                if (!kIsWeb) const PopupMenuItem(value: 'open', child: Text('Open in another app')),
                const PopupMenuItem(value: 'reload', child: Text('Load again')),
                if (widget.variants.isNotEmpty) ...[
                  const PopupMenuDivider(),
                  if (current != widget.file) const PopupMenuItem(value: 'v:-1', child: Text('Customer copy')),
                  for (final (i, v) in widget.variants.indexed)
                    if (current != v.file) PopupMenuItem(value: 'v:$i', child: Text(v.label)),
                ],
              ],
            ),
        ],
      ),
      body: Column(children: [
        if (f != null && f.fromCopy)
          Padding(
            padding: const EdgeInsets.fromLTRB(Gap.lg, 0, Gap.lg, Gap.sm),
            child: MessageBanner('No connection. This is the copy kept on the phone${f.savedAt == null ? '' : ' from ${fmtDate(f.savedAt)}'}.',
                tone: Tone.warn),
          ),
        if (current.internal)
          const Padding(
            padding: EdgeInsets.fromLTRB(Gap.lg, 0, Gap.lg, Gap.sm),
            child: MessageBanner('Internal copy: for us only. Do not send it to the customer.', tone: Tone.warn),
          ),
        Expanded(child: _body(context)),
        if (f != null)
          SafeArea(
            top: false,
            child: Container(
              padding: const EdgeInsets.fromLTRB(Gap.lg, Gap.sm, Gap.lg, Gap.sm),
              decoration: BoxDecoration(color: c.surface, border: Border(top: BorderSide(color: c.line))),
              child: Row(children: [
                Expanded(child: OutlinedButton.icon(onPressed: _save, icon: const Icon(Icons.download, size: 18), label: Text(kIsWeb ? 'Download' : 'Save'))),
                const SizedBox(width: Gap.md),
                Expanded(child: FilledButton.icon(onPressed: _share, icon: const Icon(Icons.ios_share, size: 18), label: const Text('Share'))),
              ]),
            ),
          ),
      ]),
    );
  }

  Widget _body(BuildContext context) {
    final f = file;
    if (error != null) return ErrorView(error!, retry: _load);
    if (f == null) {
      final p = progress ?? 0;
      return Center(
        child: Semantics(
          label: 'Downloading ${current.name}',
          value: p > 0 ? '${(p * 100).round()}%' : null,
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            SizedBox(width: 200, child: LinearProgressIndicator(value: p > 0 ? p : null)),
            const SizedBox(height: Gap.md),
            Text(p > 0 ? 'Downloading ${(p * 100).round()}%' : 'Opening…', style: context.text.bodySmall),
          ]),
        ),
      );
    }
    return switch (f.kind) {
      FileKind.pdf => Semantics(
          label: 'PDF ${f.name}${pages > 0 ? ', $pages pages' : ''}. Pinch to zoom.',
          child: ColoredBox(
            color: context.colors.surface3,
            child: PdfViewer.data(
              f.bytes,
              key: ValueKey(current.path),
              sourceName: current.path,
              params: PdfViewerParams(
                backgroundColor: context.colors.surface3,
                margin: Gap.md,
                onViewerReady: (doc, _) => setState(() => pages = doc.pages.length),
                onPageChanged: (p) => setState(() => page = p ?? page),
                errorBannerBuilder: (ctx, _, _, _) => ColoredBox(
                  color: context.colors.bg,
                  child: _cannot(ctx, f, 'This PDF could not be opened; it may be damaged or not a PDF.'),
                ),
              ),
            ),
          ),
        ),
      FileKind.image => Semantics(
          image: true,
          label: 'Photo ${f.name}. Pinch to zoom.',
          child: InteractiveViewer(
            maxScale: 6,
            child: Center(
              child: Image.memory(f.bytes, errorBuilder: (_, _, _) => _cannot(context, f, 'This photo could not be shown here.')),
            ),
          ),
        ),
      FileKind.video => kIsWeb || f.localPath == null ? _cannot(context, f, 'Videos play in another app.') : _Video(path: f.localPath!),
      FileKind.text => SingleChildScrollView(
          padding: const EdgeInsets.all(Gap.lg),
          child: SelectableText(utf8.decode(f.bytes, allowMalformed: true), style: context.text.bodyMedium),
        ),
      FileKind.other => _cannot(context, f, 'This kind of file cannot be shown inside the app.'),
    };
  }

  Widget _cannot(BuildContext context, LoadedFile f, String why) => Center(
        child: EmptyState(
          title: f.name,
          text: '$why ${kIsWeb ? 'Download it to open it.' : 'Open it in another app, save it or share it.'}',
          action: kIsWeb
              ? FilledButton(onPressed: _save, child: const Text('Download'))
              : FilledButton(onPressed: _elsewhere, child: const Text('Open in another app')),
        ),
      );
}

class _Video extends StatefulWidget {
  const _Video({required this.path});
  final String path;

  @override
  State<_Video> createState() => _VideoState();
}

class _VideoState extends State<_Video> {
  late final VideoPlayerController ctl = VideoPlayerController.file(File(widget.path))
    ..initialize().then((_) {
      if (mounted) setState(() {});
    });

  @override
  void dispose() {
    ctl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!ctl.value.isInitialized) return const LoadingView();
    return Column(children: [
      Expanded(child: Center(child: AspectRatio(aspectRatio: ctl.value.aspectRatio, child: VideoPlayer(ctl)))),
      VideoProgressIndicator(ctl, allowScrubbing: true, padding: const EdgeInsets.symmetric(horizontal: Gap.lg, vertical: Gap.sm)),
      IconButton(
        iconSize: 40,
        tooltip: ctl.value.isPlaying ? 'Pause' : 'Play',
        icon: Icon(ctl.value.isPlaying ? Icons.pause_circle : Icons.play_circle),
        onPressed: () => setState(() => ctl.value.isPlaying ? ctl.pause() : ctl.play()),
      ),
    ]);
  }
}

/// An icon for the kind of file, so a list reads at a glance.
IconData fileIcon(RemoteFile f) => switch (f.kind) {
      FileKind.pdf => Icons.picture_as_pdf_outlined,
      FileKind.image => Icons.image_outlined,
      FileKind.video => Icons.movie_outlined,
      FileKind.text => Icons.description_outlined,
      FileKind.other => f.name.toLowerCase().endsWith('.zip') ? Icons.folder_zip_outlined : Icons.insert_drive_file_outlined,
    };

/// A file in a list: icon, name, a line of details, an optional status; tap opens it.
class FileRow extends StatelessWidget {
  const FileRow({super.key, required this.file, this.title, this.sub = const [], this.badge, this.onTap, this.divider = true});
  final RemoteFile file;

  /// What the row is called when it is not the file name, e.g. "Sales contract".
  final String? title;
  final List<String?> sub;
  final Badge? badge;

  /// Null: the file opens in the viewer. Rows that cannot be opened pass a no-op and no icon.
  final VoidCallback? onTap;
  final bool divider;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final line = joinParts(sub);
    return Column(mainAxisSize: MainAxisSize.min, children: [
      MergeSemantics(
        child: Semantics(
          button: onTap != null,
          child: InkWell(
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: Gap.md),
              child: Row(children: [
                ExcludeSemantics(child: Icon(fileIcon(file), color: onTap == null ? c.muted : c.primary)),
                const SizedBox(width: Gap.md),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(title ?? file.name, style: context.text.titleSmall, maxLines: 2, overflow: TextOverflow.ellipsis),
                    if (line.isNotEmpty)
                      Text(line, style: context.text.bodySmall?.copyWith(color: c.text2), maxLines: 2, overflow: TextOverflow.ellipsis),
                  ]),
                ),
                if (badge != null) ...[const SizedBox(width: Gap.sm), StatusBadge(badge!)],
                if (onTap != null) ...[const SizedBox(width: Gap.xs), Icon(Icons.chevron_right, color: c.muted, size: 20)],
              ]),
            ),
          ),
        ),
      ),
      if (divider) Divider(height: 1, color: c.line),
    ]);
  }
}
