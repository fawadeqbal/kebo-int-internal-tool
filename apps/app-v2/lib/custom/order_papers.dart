import 'package:flutter/material.dart' hide Badge;

import '../core/api.dart';
import '../core/files.dart';
import '../core/json.dart';
import '../core/scope.dart';
import '../ds/ds.dart';
import '../generated/models.g.dart';
import 'paper_make.dart';

/// Where a paper stands, with the same words and colours as the web.
const _state = {
  'ready': Badge('Ready', Tone.ok),
  'draft': Badge('Draft', Tone.info),
  'can': Badge('Can be made', Tone.info),
  'wait': Badge('Waiting for data', Tone.warn),
  'up': Badge('Uploaded', Tone.info),
  'miss': Badge('Missing', Tone.warn),
  'else': Badge('Kept elsewhere', Tone.neutral),
};

/// Papers with prices that also have a copy for us only (costs, margin, every payment).
const _hasInternal = {'proforma', 'revisions'};

/// A paper of the order, ready to open.
class _Paper {
  const _Paper({required this.key, required this.label, required this.state, this.number, this.sub, this.file, this.internal, this.kind, this.ref, this.makeable = false});
  final String key, label, state;
  final String? number, sub, kind, ref;

  /// The app makes it (Make opens its checks); false for papers others issue.
  final bool makeable;
  final RemoteFile? file;
  final RemoteFile? internal;

  bool get done => state == 'ready' || state == 'up' || state == 'draft';
}

/// Every paper of an order as a PDF inside the app: the accepted quotation and
/// the proforma (customer copy and internal copy), the papers the system makes,
/// and the ones uploaded. Papers that are made on the web still show where they stand.
class OrderPapers extends StatefulWidget {
  const OrderPapers(this.order, {super.key, required this.title});
  final Order order;
  final String title;

  @override
  State<OrderPapers> createState() => _OrderPapersState();
}

class _OrderPapersState extends State<OrderPapers> {
  List<_Paper>? papers;
  String? error;
  bool canMake = false;
  bool all = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (papers == null && error == null) _load();
  }

  RemoteFile _pdf(String kind, String id, String name, {String? ref, bool internal = false, String? note}) {
    final q = {'ref': ?ref, if (internal) 'copy': 'internal'};
    return RemoteFile(
      path: Uri(path: '/pdf/$kind/$id', queryParameters: q.isEmpty ? null : q).toString(),
      name: '$name.pdf',
      type: 'application/pdf',
      note: note,
      internal: internal,
    );
  }

  Future<void> _load() async {
    final o = widget.order;
    try {
      final j = await context.api.get('/api/orders/${o.id}/papers');
      final out = <_Paper>[];
      for (final d in o.documents.where((d) => d.kind == 'quotation' && d.revisionId != null)) {
        final label = d.label ?? 'Quotation';
        out.add(_Paper(
          key: 'quotation',
          label: label,
          state: 'ready',
          file: _pdf('revisions', d.revisionId!, label, note: label),
          internal: _pdf('revisions', d.revisionId!, '$label (internal)', internal: true, note: 'Internal copy'),
        ));
      }
      for (final p in j.list('papers', (m) => m)) {
        final kind = p.str('kind');
        final label = p.str('label');
        final number = p.strOrNull('number');
        final name = [label, ?number].join(' ');
        final uploaded = p.obj('doc', (d) => d.obj('file', (f) => f));
        RemoteFile? file;
        if (uploaded != null) {
          file = RemoteFile(path: '/api/files/${uploaded.str('id')}', name: uploaded.str('name'), note: label);
        } else if (p.boolean('printable')) {
          file = _pdf(kind, o.id, name, ref: p.strOrNull('ref'), note: number);
        }
        out.add(_Paper(
          key: p.str('key'),
          label: label,
          state: p.str('state'),
          number: number,
          sub: p.strOrNull('sub'),
          file: file,
          internal: _hasInternal.contains(kind) && file != null && uploaded == null
              ? _pdf(kind, o.id, '$name (internal)', internal: true, note: 'Internal copy')
              : null,
          kind: kind,
          ref: p.strOrNull('ref'),
          makeable: p.boolean('makeable'),
        ));
      }
      if (mounted) {
        setState(() {
          papers = out;
          canMake = j.boolean('canMake') && context.can('documents.manage');
        });
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => error = e.message);
    }
  }

  /// The app makes this paper and the person may: "Make" under it.
  bool _makes(_Paper p) => canMake && p.makeable && const {'can', 'draft', 'wait'}.contains(p.state);

  /// Notes in the order's history that a paper left the company.
  void _noted(String key, String via) {
    if (key == 'quotation') return;
    context.api.post('/api/orders/${widget.order.id}/files/share', {'papers': [key], 'via': via}).ignore();
  }

  void _open(_Paper p, {bool internal = false}) {
    final main = internal ? p.internal! : p.file!;
    openFile(
      context,
      main,
      // Like the web: everyone who sees the paper gets the internal copy; the server leaves out costs they may not see.
      variants: [if (!internal && p.internal != null) FileVariant('Internal copy', p.internal!)],
      onShared: internal ? null : (via) => _noted(p.key, via),
    );
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final list = papers;
    if (list == null) {
      return SectionCard(
        title: widget.title,
        child: error == null
            ? const Padding(padding: EdgeInsets.all(Gap.lg), child: LoadingView())
            : Padding(
                padding: const EdgeInsets.symmetric(vertical: Gap.md),
                child: MessageBanner(error!, tone: Tone.bad, action: TextButton(onPressed: () {
                  setState(() => error = null);
                  _load();
                }, child: const Text('Try again'))),
              ),
      );
    }
    final done = list.where((p) => p.done).toList();
    final rest = list.where((p) => !p.done).toList();
    final shown = all ? [...done, ...rest] : done;
    return SectionCard(
      title: widget.title,
      count: done.length,
      child: Column(children: [
        if (shown.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: Gap.md),
            child: Text('No papers made yet', style: context.text.bodySmall?.copyWith(color: c.muted)),
          ),
        for (final (i, p) in shown.indexed) ...[
          FileRow(
            file: p.file ?? RemoteFile(path: '', name: p.label),
            title: p.label,
            sub: [if (p.file != null) p.number, p.sub],
            badge: _state[p.state],
            onTap: p.file == null ? null : () => _open(p),
            divider: p.internal == null && !_makes(p) && (i < shown.length - 1 || (!all && rest.isNotEmpty)),
          ),
          if (_makes(p))
            Padding(
              padding: const EdgeInsets.only(left: 28),
              child: Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: () async {
                    if (await openMakePaper(context, orderId: widget.order.id, kind: p.kind!, label: p.label, ref: p.ref) && context.mounted) {
                      await _load();
                      if (context.mounted) await RecordScope.reloadOf(context);
                    }
                  },
                  icon: const Icon(Icons.edit_document, size: 16),
                  label: Text(p.state == 'draft' ? 'Make it final' : 'Make', semanticsLabel: 'Make the ${p.label}'),
                ),
              ),
            ),
          if (_makes(p) && p.internal == null && (i < shown.length - 1 || (!all && rest.isNotEmpty))) Divider(height: 1, color: c.line),
          if (p.internal != null) ...[
            Padding(
              padding: const EdgeInsets.only(left: 28),
              child: Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: () => _open(p, internal: true),
                  icon: const Icon(Icons.lock_outline, size: 16),
                  label: Text('Internal copy', semanticsLabel: 'Internal copy of ${p.label}'),
                ),
              ),
            ),
            if (i < shown.length - 1 || (!all && rest.isNotEmpty)) Divider(height: 1, color: c.line),
          ],
        ],
        if (rest.isNotEmpty)
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              onPressed: () => setState(() => all = !all),
              child: Text(all ? 'Show only ready papers' : 'Show ${rest.length} more (can be made, waiting, missing)'),
            ),
          ),
      ]),
    );
  }
}
