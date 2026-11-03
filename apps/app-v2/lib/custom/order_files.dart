import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/files.dart';
import '../core/json.dart';
import '../core/scope.dart';
import '../ds/ds.dart';
import '../generated/models.g.dart';

const _steps = {
  'payment': 'Payment',
  'factory': 'Factory order',
  'production': 'Production',
  'shipping': 'Shipping',
  'documents': 'Documents & bank',
  'delivery': 'Delivery & SAT',
};
const _kinds = {'photo': 'Photo', 'drawing': 'Drawing', 'specification': 'Specification', 'urs': 'URS', 'factory_quote': 'Factory quotation', 'other': 'Other'};

const _uploadFields = [
  FieldDef('step', 'Step', FieldKind.choice, options: _steps),
  FieldDef('kind', 'What it is', FieldKind.choice, options: _kinds),
  FieldDef('note', 'Note', FieldKind.text, max: 300),
];

/// Every file of an order (uploads, payment proofs, receipts, factory files), grouped
/// like on the web. Tap opens it inside the app; Add takes a photo or picks a file.
class OrderFiles extends StatefulWidget {
  const OrderFiles(this.order, {super.key, required this.title});
  final Order order;
  final String title;

  @override
  State<OrderFiles> createState() => _OrderFilesState();
}

class _OrderFilesState extends State<OrderFiles> {
  Json? data;
  String? error;
  String group = 'all';

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (data == null && error == null) _load();
  }

  Future<void> _load() async {
    try {
      final j = await context.api.get('/api/orders/${widget.order.id}/files');
      if (mounted) setState(() => data = j);
    } on ApiException catch (e) {
      if (mounted) setState(() => error = e.message);
    }
  }

  Future<void> _add() async {
    final ok = await pickAndUpload(
      context,
      endpoint: '/api/orders/${widget.order.id}/files',
      title: 'Add to ${widget.order.refNo ?? 'the order'}',
      fields: _uploadFields,
      initial: {'kind': 'photo'},
    );
    if (ok && mounted) {
      toast(context, 'Uploaded');
      _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final d = data;
    final canAdd = d?.boolean('canUpload') ?? false;
    final add = canAdd
        ? TextButton.icon(onPressed: _add, icon: const Icon(Icons.add, size: 18), label: const Text('Add'))
        : null;
    if (d == null) {
      return SectionCard(
        title: widget.title,
        child: error == null
            ? const Padding(padding: EdgeInsets.all(Gap.lg), child: LoadingView())
            : Padding(padding: const EdgeInsets.symmetric(vertical: Gap.md), child: MessageBanner(error!, tone: Tone.bad)),
      );
    }
    final files = d.list('files', (m) => m);
    final groups = d.list('groups', (m) => m).where((g) => g.integer('count') > 0).toList();
    final shown = group == 'all' ? files : files.where((f) => f.str('group') == group).toList();
    return SectionCard(
      title: widget.title,
      count: files.isEmpty ? null : files.length,
      action: add,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (groups.length > 1)
          Padding(
            padding: const EdgeInsets.only(top: Gap.sm),
            child: Wrap(spacing: Gap.sm, runSpacing: Gap.sm, children: [
              ChoiceChip(label: Text('All ${files.length}'), selected: group == 'all', onSelected: (_) => setState(() => group = 'all')),
              for (final g in groups)
                ChoiceChip(
                  label: Text('${g.str('label')} ${g.integer('count')}'),
                  selected: group == g.str('key'),
                  onSelected: (_) => setState(() => group = g.str('key')),
                ),
            ]),
          ),
        if (shown.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: Gap.md),
            child: Text(canAdd ? 'No files yet. Add photos, scans or documents.' : 'No files yet',
                style: context.text.bodySmall?.copyWith(color: c.muted)),
          ),
        for (final (i, f) in shown.indexed) _row(context, f, i < shown.length - 1),
      ]),
    );
  }

  Widget _row(BuildContext context, Json f, bool divider) {
    final file = RemoteFile(
      path: '/api${f.str('href')}',
      name: f.str('name'),
      type: f.strOrNull('type'),
      size: f.integer('size'),
      note: f.strOrNull('kindLabel'),
    );
    return FileRow(
      file: file,
      sub: [
        f.strOrNull('kindLabel'),
        f.strOrNull('stepLabel'),
        fileSize(f.integer('size')),
        f.obj('by', (b) => b.str('name')),
        fmtDate(f.date('at')),
      ],
      divider: divider,
      onTap: () => openFile(context, file, onShared: (via) {
        context.api.post('/api/orders/${widget.order.id}/files/share', {'files': [f.str('id')], 'via': via}).ignore();
      }),
    );
  }
}
