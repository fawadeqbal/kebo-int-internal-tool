import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../core/api.dart';
import '../core/files.dart';
import '../core/scope.dart';
import 'fields.dart';
import 'theme.dart';
import 'tone.dart';
import 'widgets.dart';

/// A file picked on the phone, not sent yet.
class PickedFile {
  const PickedFile(this.bytes, this.name);
  final Uint8List bytes;
  final String name;
}

/// Camera, photos or files: the three ways to add a file, always in this order.
Future<PickedFile?> pickFile(BuildContext context) async {
  final how = await showModalBottomSheet<String>(
    context: context,
    useRootNavigator: true,
    builder: (ctx) => SafeArea(
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        if (!kIsWeb)
          ListTile(minTileHeight: Gap.tap, leading: const Icon(Icons.photo_camera_outlined), title: const Text('Take a photo'), onTap: () => Navigator.pop(ctx, 'camera')),
        ListTile(minTileHeight: Gap.tap, leading: const Icon(Icons.photo_library_outlined), title: const Text('Photo or video'), onTap: () => Navigator.pop(ctx, 'media')),
        ListTile(minTileHeight: Gap.tap, leading: const Icon(Icons.folder_open_outlined), title: const Text('File (PDF, Word, Excel…)'), onTap: () => Navigator.pop(ctx, 'file')),
        const SizedBox(height: Gap.sm),
      ]),
    ),
  );
  if (how == null) return null;
  if (how == 'file') {
    final r = await FilePicker.pickFiles();
    if (r.isEmpty) return null;
    return PickedFile(await r.first.readAsBytes(), r.first.name);
  }
  final picker = ImagePicker();
  final x = how == 'camera'
      ? await picker.pickImage(source: ImageSource.camera, imageQuality: 85, maxWidth: 2600)
      : await picker.pickMedia(imageQuality: 85, maxWidth: 2600);
  if (x == null) return null;
  return PickedFile(await x.readAsBytes(), x.name);
}

/// Picks a file, asks the [fields] (e.g. which step, what it is, a note), sends it to
/// [endpoint] with a progress bar. True when uploaded.
Future<bool> pickAndUpload(BuildContext context, {required String endpoint, required String title, List<FieldDef> fields = const [], Map<String, String> initial = const {}}) async {
  final picked = await pickFile(context);
  if (picked == null || !context.mounted) return false;
  final done = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    useRootNavigator: true,
    isDismissible: false,
    builder: (_) => _UploadSheet(picked: picked, endpoint: endpoint, title: title, fields: fields, initial: initial),
  );
  return done ?? false;
}

class _UploadSheet extends StatefulWidget {
  const _UploadSheet({required this.picked, required this.endpoint, required this.title, required this.fields, required this.initial});
  final PickedFile picked;
  final String endpoint, title;
  final List<FieldDef> fields;
  final Map<String, String> initial;

  @override
  State<_UploadSheet> createState() => _UploadSheetState();
}

class _UploadSheetState extends State<_UploadSheet> {
  late final values = <String, Object?>{...widget.initial};
  double? progress;
  String? problem;

  Future<void> _send() async {
    setState(() {
      progress = 0;
      problem = null;
    });
    try {
      await context.api.upload(
        widget.endpoint,
        bytes: widget.picked.bytes,
        fileName: widget.picked.name,
        fields: {for (final e in values.entries) e.key: e.value?.toString()},
        progress: (p) {
          if (mounted) setState(() => progress = p);
        },
      );
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          progress = null;
          problem = e.message;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final f = RemoteFile(path: '', name: widget.picked.name);
    final busy = progress != null;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(Gap.lg, 0, Gap.lg, Gap.lg),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
          Semantics(header: true, child: Text(widget.title, style: context.text.titleLarge)),
          const SizedBox(height: Gap.md),
          Row(children: [
            Icon(f.kind == FileKind.image ? Icons.image_outlined : Icons.insert_drive_file_outlined, color: c.primary),
            const SizedBox(width: Gap.sm),
            Expanded(child: Text(widget.picked.name, style: context.text.titleSmall, maxLines: 2, overflow: TextOverflow.ellipsis)),
            Text(fileSize(widget.picked.bytes.length), style: context.text.bodySmall?.copyWith(color: c.text2)),
          ]),
          const SizedBox(height: Gap.lg),
          if (problem != null) ...[MessageBanner(problem!, tone: Tone.bad), const SizedBox(height: Gap.md)],
          for (final d in widget.fields) ...[
            FieldEditor(def: d, value: values[d.key], onChanged: (v) => setState(() => values[d.key] = v)),
            const SizedBox(height: Gap.lg),
          ],
          if (busy) ...[
            Semantics(
              label: 'Uploading',
              value: '${((progress ?? 0) * 100).round()}%',
              child: LinearProgressIndicator(value: progress == 0 ? null : progress),
            ),
            const SizedBox(height: Gap.sm),
            Text('Uploading ${((progress ?? 0) * 100).round()}%', style: context.text.bodySmall),
            const SizedBox(height: Gap.md),
          ],
          Row(children: [
            Expanded(child: OutlinedButton(onPressed: busy ? null : () => Navigator.pop(context, false), child: const Text('Cancel'))),
            const SizedBox(width: Gap.md),
            Expanded(child: FilledButton(onPressed: busy ? null : _send, child: const Text('Upload'))),
          ]),
        ]),
      ),
    );
  }
}
