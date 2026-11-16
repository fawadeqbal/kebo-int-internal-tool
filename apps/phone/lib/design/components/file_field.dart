import 'package:flutter/material.dart';

import '../icons.dart';
import '../theme.dart';
import 'button.dart';
import 'content.dart';
import 'pressable.dart';

/// One file in a [KFileField]: uploaded, uploading ([progress] 0–1) or failed ([error]).
class KFileItem {
  const KFileItem({required this.name, required this.bytes, this.progress, this.error});

  final String name;
  final int bytes;
  final double? progress;
  final String? error;

  bool get uploading => progress != null && error == null;

  static String size(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(0)} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  KIconData get icon {
    final ext = name.contains('.') ? name.split('.').last.toLowerCase() : '';
    return switch (ext) {
      'jpg' || 'jpeg' || 'png' || 'heic' || 'webp' => KIcons.camera,
      'mp4' || 'mov' => KIcons.play,
      _ => KIcons.file,
    };
  }
}

/// Kestrel › FileField: an optional proof or attachment inside a form or sheet. Photo first
/// on phones. Uploads happen in place; a failed file says why and offers Try again.
/// With [multiple] false there is one live file and "Add" becomes "Replace".
/// Picking and uploading are the screen's job; this only shows the state and the choices.
class KFileField extends StatelessWidget {
  const KFileField({
    super.key,
    required this.label,
    required this.files,
    this.help,
    this.optional = true,
    this.multiple = false,
    this.camera = true,
    this.onTakePhoto,
    this.onChooseFile,
    this.onOpen,
    this.onRetry,
    this.onRemove,
    this.error,
  });

  final String label;
  final String? help;
  final bool optional;
  final bool multiple;
  final bool camera;
  final List<KFileItem> files;
  final VoidCallback? onTakePhoto;
  final VoidCallback? onChooseFile;
  final ValueChanged<int>? onOpen;
  final ValueChanged<int>? onRetry;
  final ValueChanged<int>? onRemove;
  final String? error;

  /// The limits the system enforces (shown when a file is refused).
  static const maxBytes = 25 * 1024 * 1024;
  static const maxVideoBytes = 100 * 1024 * 1024;

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    final replace = !multiple && files.isNotEmpty;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        ExcludeSemantics(
          child: Row(
            children: [
              Flexible(
                child: Text(label, style: KType.label.copyWith(color: c.ink)),
              ),
              if (optional) Text('  Optional', style: KType.footnote.copyWith(color: c.inkMuted)),
            ],
          ),
        ),
        if (help != null) ...[
          const SizedBox(height: 2),
          Text(help!, style: KType.footnote.copyWith(color: c.inkMuted)),
        ],
        const SizedBox(height: KSpace.s2),
        for (var i = 0; i < files.length; i++) ...[
          _FileRow(
            file: files[i],
            onOpen: onOpen == null ? null : () => onOpen!(i),
            onRetry: onRetry == null ? null : () => onRetry!(i),
            onRemove: onRemove == null ? null : () => onRemove!(i),
          ),
          const SizedBox(height: KSpace.s2),
        ],
        Semantics(
          label: '$label${optional ? ', optional' : ''}',
          container: true,
          explicitChildNodes: true,
          child: Container(
            padding: const EdgeInsets.all(KSpace.s2),
            decoration: BoxDecoration(
              color: c.surfaceSunken,
              borderRadius: BorderRadius.circular(KRadius.md),
              border: Border.all(color: error != null ? c.danger : c.line),
            ),
            child: Row(
              children: [
                if (camera) ...[
                  Expanded(
                    child: KButton(
                      replace ? 'New photo' : 'Take photo',
                      icon: KIcons.camera,
                      variant: KButtonVariant.secondary,
                      onPressed: onTakePhoto,
                    ),
                  ),
                  const SizedBox(width: KSpace.s2),
                ],
                Expanded(
                  child: KButton(
                    replace ? 'Replace' : (files.isEmpty ? 'Choose file' : 'Add another'),
                    icon: KIcons.upload,
                    variant: KButtonVariant.secondary,
                    onPressed: onChooseFile,
                  ),
                ),
              ],
            ),
          ),
        ),
        if (error != null) ...[
          const SizedBox(height: KSpace.s1),
          Semantics(
            liveRegion: true,
            child: Text(error!, style: KType.footnote.copyWith(color: c.danger)),
          ),
        ],
      ],
    );
  }
}

class _FileRow extends StatelessWidget {
  const _FileRow({required this.file, this.onOpen, this.onRetry, this.onRemove});

  final KFileItem file;
  final VoidCallback? onOpen;
  final VoidCallback? onRetry;
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    final failed = file.error != null;
    final status = failed
        ? 'Failed: ${file.error}'
        : file.uploading
        ? 'Uploading ${(file.progress! * 100).round()}%'
        : KFileItem.size(file.bytes);
    return Container(
      padding: const EdgeInsets.only(left: KSpace.s3),
      decoration: BoxDecoration(
        color: failed ? c.dangerSoft : c.surface,
        borderRadius: BorderRadius.circular(KRadius.md),
        border: Border.all(color: failed ? c.danger : c.line),
      ),
      child: Column(
        children: [
          Row(
            children: [
              KIcon(failed ? KIcons.error : file.icon, color: failed ? c.danger : c.inkMuted),
              const SizedBox(width: KSpace.s3),
              Expanded(
                child: Pressable(
                  onPressed: failed || file.uploading ? null : onOpen,
                  scale: 1,
                  semanticLabel: '${file.name}, $status',
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          file.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: KType.callout.copyWith(color: c.ink, fontWeight: FontWeight.w500),
                        ),
                        Text(status, style: KType.footnote.copyWith(color: failed ? c.onDangerSoft : c.inkMuted)),
                      ],
                    ),
                  ),
                ),
              ),
              if (failed && onRetry != null) KButton('Try again', variant: KButtonVariant.tertiary, onPressed: onRetry),
              if (onRemove != null)
                Pressable(
                  semanticLabel: 'Remove ${file.name}',
                  onPressed: onRemove,
                  child: KIcon(KIcons.close, size: 20, color: c.inkMuted),
                ),
            ],
          ),
          if (file.uploading)
            Padding(
              padding: const EdgeInsets.fromLTRB(0, 0, KSpace.s3, KSpace.s2),
              child: KProgress(value: file.progress!, label: 'Uploading ${file.name}'),
            ),
        ],
      ),
    );
  }
}
