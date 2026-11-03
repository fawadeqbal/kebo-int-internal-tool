import 'package:flutter/material.dart';

import '../core/files.dart';
import '../core/json.dart';
import '../ds/ds.dart';
import '../generated/models.g.dart';

const _kinds = {'photo': 'Photo', 'urs': 'URS', 'drawing': 'Drawing', 'specification': 'Specification', 'other': 'Other'};

/// The inquiry's files (URS, drawings, photos): open inside the app; Add takes a photo or picks a file.
class InquiryFiles extends StatelessWidget {
  const InquiryFiles(this.inquiry, {super.key, required this.title});
  final Inquiry inquiry;
  final String title;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final files = (inquiry.attachments as List<dynamic>? ?? const []).whereType<Map<String, dynamic>>().toList();
    Future<void> add() async {
      final ok = await pickAndUpload(
        context,
        endpoint: '/api/inquiries/${inquiry.id}/files',
        title: 'Add to ${inquiry.refNo ?? 'the inquiry'}',
        fields: const [FieldDef('kind', 'What it is', FieldKind.choice, options: _kinds), FieldDef('note', 'Note', FieldKind.text, max: 300)],
        initial: const {'kind': 'photo'},
      );
      if (ok && context.mounted) {
        toast(context, 'Uploaded');
        await RecordScope.reloadOf(context);
      }
    }

    return SectionCard(
      title: title,
      count: files.isEmpty ? null : files.length,
      action: TextButton.icon(onPressed: add, icon: const Icon(Icons.add, size: 18), label: const Text('Add')),
      child: Column(children: [
        if (files.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: Gap.md),
            child: Text('No files yet. Add the URS, drawings or photos.', style: context.text.bodySmall?.copyWith(color: c.muted)),
          ),
        for (final (i, f) in files.indexed)
          Builder(builder: (context) {
            final file = RemoteFile(path: '/api/files/${f.str('id')}', name: f.str('fileName'), type: f.strOrNull('mimeType'), size: f.integer('size'));
            return FileRow(
              file: file,
              sub: [_kinds[f.strOrNull('kind')], fileSize(f.integer('size')), fmtDate(f.date('createdAt')), f.strOrNull('note')],
              onTap: () => openFile(context, file),
              divider: i < files.length - 1,
            );
          }),
      ]),
    );
  }
}
