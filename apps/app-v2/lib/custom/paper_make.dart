import 'package:flutter/material.dart' hide Badge;

import '../core/api.dart';
import '../core/files.dart';
import '../core/json.dart';
import '../core/scope.dart';
import '../ds/ds.dart';
import 'waiting.dart';

/// Making a paper the app writes (sales contract, commercial invoice…): what it takes from the
/// order and what is missing (typed here when it can be), its options, then final. True when made.
Future<bool> openMakePaper(BuildContext context, {required String orderId, required String kind, required String label, String? ref}) async {
  // A paper is made and numbered by the server: it can't wait on the phone.
  if (!needsConnection(context)) return false;
  final made = await showModalBottomSheet<Json>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    useRootNavigator: true,
    builder: (_) => _MakeSheet(orderId: orderId, kind: kind, label: label, ref: ref),
  );
  if (made == null || !context.mounted) return made != null;
  final number = made.strOrNull('number');
  toast(context, joinParts(['Made', label, number]),
      action: 'Share',
      onAction: () => shareWithMessage(
            context,
            title: 'Share · ${label.toLowerCase()}',
            file: paperPdf(kind, orderId, ref: ref, name: joinParts([label, number]).replaceAll(' · ', ' '), note: number),
            subject: joinParts([label, number, made.strOrNull('refNo')]),
            message: 'Dear Sir or Madam,\n\nPlease find attached our ${label.toLowerCase()}${number == null ? '' : ' $number'} for order ${made.str('refNo')}.\n\n'
                'Best regards,\n${joinParts([context.session.me?.name, context.session.me?.company]).replaceAll(' · ', '\n')}',
            onShared: (msg, _) => context.api.post('/api/orders/$orderId/files/share', {
              'papers': [ref == null ? kind : '$kind:$ref'],
              'files': <String>[],
              'via': 'share',
              'message': msg,
            }).ignore(),
          ));
  return true;
}

/// The paper as a PDF, from the web host (a final version as it was made, else from the order now).
RemoteFile paperPdf(String kind, String orderId, {String? ref, String? opts, required String name, String? note}) {
  final q = {'ref': ?ref, 'opts': ?opts};
  return RemoteFile(path: Uri(path: '/pdf/$kind/$orderId', queryParameters: q.isEmpty ? null : q).toString(), name: '$name.pdf', type: 'application/pdf', note: note);
}

class _MakeSheet extends StatefulWidget {
  const _MakeSheet({required this.orderId, required this.kind, required this.label, this.ref});
  final String orderId, kind, label;
  final String? ref;

  @override
  State<_MakeSheet> createState() => _MakeSheetState();
}

class _MakeSheetState extends State<_MakeSheet> {
  Json? c; // the checks
  final options = <String, bool>{};
  final typed = <String, TextEditingController>{};
  String? problem;
  bool busy = false;

  String get base => '/api/orders/${widget.orderId}/papers/${widget.kind}';
  Map<String, String> get q => {'ref': ?widget.ref};

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (c == null && problem == null) _load();
  }

  @override
  void dispose() {
    for (final t in typed.values) {
      t.dispose();
    }
    super.dispose();
  }

  void _take(Json j) => setState(() {
        c = j;
        for (final o in j.list('options', (m) => m)) {
          options.putIfAbsent(o.str('key'), () => o.boolean('on'));
        }
      });

  Future<void> _load() async {
    try {
      _take(await context.api.get('$base/checks', query: q));
    } on ApiException catch (e) {
      if (mounted) setState(() => problem = e.message);
    }
  }

  /// Saves one missing value where it belongs (the order, a line, the shipment); the checks come back.
  Future<void> _fix(String field, String value, {String? lineId}) async {
    if (value.trim().isEmpty) return;
    setState(() {
      busy = true;
      problem = null;
    });
    try {
      final path = Uri(path: '$base/fix', queryParameters: q.isEmpty ? null : q).toString();
      _take(await context.api.post(path, {'field': field, 'value': value.trim(), 'lineId': ?lineId}));
    } on ApiException catch (e) {
      if (mounted) setState(() => problem = e.message);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _final() async {
    setState(() {
      busy = true;
      problem = null;
    });
    final api = context.api;
    try {
      var paper = c!.objAt('paper');
      if (paper == null || paper.str('status') != 'draft') {
        paper = (await api.post(base, {'options': options, 'ref': ?widget.ref})).objAt('paper');
      }
      final done = await api.post('/api/papers/${paper!.str('id')}/final', {'options': options});
      if (mounted) Navigator.pop(context, {'number': done.at('paper.number') ?? c!.strOrNull('number'), 'refNo': c!.str('refNo')});
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          busy = false;
          problem = e.message;
        });
      }
    }
  }

  TextEditingController _ctl(String key) => typed.putIfAbsent(key, TextEditingController.new);

  @override
  Widget build(BuildContext context) {
    final cl = context.colors;
    final j = c;
    final inset = MediaQuery.viewInsetsOf(context).bottom;
    return SizedBox(
      height: MediaQuery.sizeOf(context).height * 0.92,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(Gap.lg, 0, Gap.xs, Gap.xs),
          child: Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Semantics(header: true, child: Text('Make · ${widget.label}', style: context.text.titleLarge)),
                if (j != null) Text(joinParts([j.strOrNull('number'), j.strOrNull('madeFrom')]), style: context.text.bodySmall?.copyWith(color: cl.text2)),
              ]),
            ),
            IconButton(icon: const Icon(Icons.close), tooltip: 'Close', onPressed: () => Navigator.pop(context)),
          ]),
        ),
        Divider(height: 1, color: cl.line),
        Expanded(
          child: j == null
              ? (problem == null ? const LoadingView() : Padding(padding: const EdgeInsets.all(Gap.lg), child: MessageBanner(problem!, tone: Tone.bad)))
              : ListView(padding: EdgeInsets.fromLTRB(Gap.lg, Gap.md, Gap.lg, Gap.lg + inset), children: _body(context, j)),
        ),
        if (j != null)
          Container(
            padding: EdgeInsets.fromLTRB(Gap.lg, Gap.md, Gap.lg, Gap.md + MediaQuery.paddingOf(context).bottom),
            decoration: BoxDecoration(color: cl.surface, border: Border(top: BorderSide(color: cl.line))),
            child: Row(children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => openFile(
                    context,
                    paperPdf(widget.kind, widget.orderId,
                        ref: widget.ref, opts: options.entries.where((e) => e.value).map((e) => e.key).join(','), name: '${widget.label} (preview)', note: 'Preview'),
                  ),
                  child: const Text('Preview'),
                ),
              ),
              const SizedBox(width: Gap.sm),
              Expanded(
                flex: 2,
                child: FilledButton(
                  onPressed: busy || !j.boolean('ready') ? null : _final,
                  child: busy
                      ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                      : Text(j.boolean('ready') ? 'Make it final' : 'Fill what is missing first'),
                ),
              ),
            ]),
          ),
      ]),
    );
  }

  List<Widget> _body(BuildContext context, Json j) {
    final cl = context.colors;
    final fixes = j.objAt('fixes') ?? const <String, Object?>{};
    final checks = j.list('checks', (m) => m);
    return [
      if (problem != null) ...[MessageBanner(problem!, tone: Tone.bad), const SizedBox(height: Gap.md)],
      if (j.objAt('paper')?.str('status') == 'draft') ...[
        const MessageBanner('A draft is saved; making it final locks its number.', tone: Tone.info),
        const SizedBox(height: Gap.md),
      ],
      Text('What it takes from the order', style: context.text.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
      const SizedBox(height: Gap.xs),
      for (final ch in checks) ...[
        MergeSemantics(
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: Gap.sm),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Icon(ch.boolean('ok') ? Icons.check_circle : (ch.boolean('required') ? Icons.error_outline : Icons.radio_button_unchecked),
                  size: 20, color: ch.boolean('ok') ? cl.ok : (ch.boolean('required') ? cl.bad : cl.muted), semanticLabel: ch.boolean('ok') ? 'Done' : (ch.boolean('required') ? 'Needed' : 'Optional')),
              const SizedBox(width: Gap.sm),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(ch.str('label'), style: context.text.bodyMedium?.copyWith(fontWeight: FontWeight.w500)),
                  Text(ch.str('value'), style: context.text.bodySmall?.copyWith(color: cl.text2)),
                  if (!ch.boolean('ok') && ch.strOrNull('fix') == null && ch.boolean('required'))
                    Text('Fill it in on the order first', style: context.text.bodySmall?.copyWith(color: cl.bad)),
                ]),
              ),
            ]),
          ),
        ),
        if (!ch.boolean('ok') && ch.strOrNull('fix') != null) ..._fixRows(context, ch.str('fix'), fixes[ch.str('fix')] as Json?, j),
        Divider(height: 1, color: cl.line),
      ],
      if (j.list('options', (m) => m).isNotEmpty) ...[
        const SizedBox(height: Gap.md),
        Text('On the paper', style: context.text.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
        for (final o in j.list('options', (m) => m))
          MergeSemantics(
            child: SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(o.str('label'), style: context.text.bodyMedium),
              value: options[o.str('key')] ?? false,
              onChanged: (v) => setState(() => options[o.str('key')] = v),
            ),
          ),
      ],
    ];
  }

  /// A missing value typed in place: one box (a date or a word), or one per line for HS codes.
  List<Widget> _fixRows(BuildContext context, String field, Json? fix, Json j) {
    final label = fix?.str('label') ?? field;
    final saves = fix?.strOrNull('saves');
    Widget row(String key, String hint, {String? lineId}) {
      final ctl = _ctl(key);
      final isDate = fix?.str('type') == 'date';
      return Padding(
        padding: const EdgeInsets.only(left: 28, bottom: Gap.sm),
        child: Row(children: [
          Expanded(
            child: isDate
                ? OutlinedButton.icon(
                    onPressed: busy
                        ? null
                        : () async {
                            final now = DateTime.now();
                            final d = await showDatePicker(context: context, initialDate: now, firstDate: DateTime(now.year - 2), lastDate: DateTime(now.year + 3));
                            if (d != null) await _fix(field, isoDay(d)!, lineId: lineId);
                          },
                    icon: const Icon(Icons.calendar_today_outlined, size: 16),
                    label: Text('Choose the ${label.toLowerCase()}'),
                  )
                : TextField(
                    controller: ctl,
                    maxLength: 120,
                    decoration: InputDecoration(labelText: hint, helperText: saves == null ? null : 'Saved on $saves', counterText: ''),
                    onSubmitted: (v) => _fix(field, v, lineId: lineId),
                  ),
          ),
          if (!isDate) ...[
            const SizedBox(width: Gap.sm),
            TextButton(onPressed: busy ? null : () => _fix(field, ctl.text, lineId: lineId), child: Text('Save', semanticsLabel: 'Save $hint')),
          ],
        ]),
      );
    }

    if (field == 'hs') {
      return [for (final l in j.list('hsLines', (m) => m)) row('hs:${l.str('id')}', '$label · ${l.str('description')}', lineId: l.str('id'))];
    }
    return [row(field, label)];
  }
}
