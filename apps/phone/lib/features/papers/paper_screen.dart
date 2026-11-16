import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api.dart';
import '../../core/company_time.dart';
import '../../core/format.dart';
import '../../core/json.dart';
import '../../core/links.dart';
import '../../core/providers.dart';
import '../../design/design.dart';

typedef PaperKey = ({String orderId, String kind, String? ref});

/// The Make page of a paper: what it takes from the order, what is missing (typed here when
/// it can be), its options, its versions; save a draft, make it final. Printing is on the web.
final paperChecksProvider = FutureProvider.autoDispose.family<Json, PaperKey>((ref, k) async {
  final api = ref.watch(sessionProvider.notifier).api;
  return api.get('/api/orders/${k.orderId}/papers/${k.kind}/checks', query: {'ref': ?k.ref});
});

class PaperScreen extends ConsumerStatefulWidget {
  const PaperScreen({super.key, required this.orderId, required this.kind, this.paperRef});
  final String orderId, kind;
  final String? paperRef;

  @override
  ConsumerState<PaperScreen> createState() => _PaperScreenState();
}

class _PaperScreenState extends ConsumerState<PaperScreen> {
  Map<String, bool>? _options;
  bool _busy = false;

  PaperKey get _k => (orderId: widget.orderId, kind: widget.kind, ref: widget.paperRef);
  Api get _api => ref.read(sessionProvider.notifier).api;
  String get _base => '/api/orders/${widget.orderId}/papers/${widget.kind}';

  Future<void> _act(String done, Future<void> Function() call) async {
    setState(() => _busy = true);
    try {
      await call();
      KHaptics.success();
      if (mounted) showKToast(context, done, icon: KIcons.check);
      ref.invalidate(paperChecksProvider(_k));
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, icon: KIcons.error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _withRef(String path) =>
      widget.paperRef == null ? path : '$path?ref=${Uri.encodeQueryComponent(widget.paperRef!)}';

  @override
  Widget build(BuildContext context) {
    final p = ref.watch(paperChecksProvider(_k));
    return Scaffold(
      backgroundColor: context.k.bg,
      appBar: KTopBar(
        title: p.value?.str('label') ?? 'Paper',
        actions: [
          KIconButton(
            KIcons.globe,
            label: 'View and print on the web',
            onPressed: () => openLink(context, _api, '/orders/${widget.orderId}/papers/${widget.kind}'),
          ),
        ],
      ),
      body: switch (p) {
        AsyncValue(:final value?) => _body(context, value),
        AsyncValue(:final error?) => Padding(
          padding: const EdgeInsets.all(KSpace.s4),
          child: KBanner(error.toString(), tone: KTone.danger),
        ),
        _ => const Padding(padding: EdgeInsets.all(KSpace.s4), child: KSkeleton(height: 240)),
      },
    );
  }

  Widget _body(BuildContext context, Json p) {
    final c = context.k;
    final checks = p.list('checks', (m) => m);
    final missing = checks.where((x) => !x.boolean('ok') && x.boolean('required')).length;
    final paper = p.objAt('paper');
    final draft = paper?.str('status') == 'draft';
    final isFinal = paper?.str('status') == 'final';
    final canMake = p.boolean('canMake');
    _options ??= {for (final o in p.list('options', (m) => m)) o.str('key'): o.boolean('on')};
    return ListView(
      padding: const EdgeInsets.only(bottom: KSpace.s16),
      children: [
        KRecordHeader(
          type: p.str('label'),
          number: p.strOrNull('number') ?? 'No number yet',
          icon: KIcons.file,
          title: p.str('refNo'),
          party: p.strOrNull('madeFrom') == null ? null : 'Made from ${p.str('madeFrom')}',
          badges: [
            KBadge(
              isFinal
                  ? 'Final'
                  : draft
                  ? 'Draft'
                  : missing > 0
                  ? 'Waiting for data'
                  : 'Can be made',
              tone: isFinal
                  ? KTone.success
                  : draft
                  ? KTone.info
                  : missing > 0
                  ? KTone.warning
                  : KTone.neutral,
            ),
            if (paper != null) KBadge('Version ${paper.integer('version')}', showToneIcon: false),
          ],
          updated: paper == null
              ? null
              : '${isFinal ? 'Made final' : 'Drafted'} ${fmtDateTime(DateTime.tryParse(paper.str(isFinal ? 'finalAt' : 'madeAt')))}',
        ),
        Padding(
          padding: const EdgeInsets.all(KSpace.s4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (missing > 0) ...[
                KBanner(
                  '$missing thing${missing == 1 ? '' : 's'} missing before it can be made final.',
                  tone: KTone.warning,
                ),
                const SizedBox(height: KSpace.s4),
              ],
              KSection(
                title: 'What it takes from the order',
                children: [
                  KCard(
                    padding: EdgeInsets.zero,
                    child: Column(
                      children: [
                        for (final (i, x) in checks.indexed)
                          KListItem(
                            leading: KIcon(
                              x.boolean('ok')
                                  ? KIcons.success
                                  : x.boolean('required')
                                  ? KIcons.warning
                                  : KIcons.info,
                              color: x.boolean('ok')
                                  ? c.success
                                  : x.boolean('required')
                                  ? c.warning
                                  : c.inkMuted,
                            ),
                            title: x.str('label'),
                            subtitle: x.strOrNull('value'),
                            meta: x.strOrNull('warn'),
                            divider: i < checks.length - 1,
                            chevron: false,
                            trailing: !x.boolean('ok') && x.strOrNull('fix') != null && x.str('fix') != 'hs' && canMake
                                ? KButton(
                                    'Add',
                                    variant: KButtonVariant.secondary,
                                    onPressed: () => _fix(context, x, p),
                                  )
                                : null,
                          ),
                      ],
                    ),
                  ),
                ],
              ),
              if ((_options ?? const {}).isNotEmpty) ...[
                const SizedBox(height: KSpace.s6),
                KSection(
                  title: 'On the paper',
                  children: [
                    KCard(
                      child: Column(
                        children: [
                          for (final o in p.list('options', (m) => m))
                            KSwitch(
                              label: o.str('label'),
                              value: _options![o.str('key')] ?? true,
                              onChanged: isFinal || !canMake
                                  ? null
                                  : (v) => setState(() => _options![o.str('key')] = v),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              ],
              if (p.list('versions', (m) => m).length > 1) ...[
                const SizedBox(height: KSpace.s6),
                KSection(
                  title: 'Versions',
                  children: [
                    KCard(
                      padding: EdgeInsets.zero,
                      child: Column(
                        children: [
                          for (final (i, v) in p.list('versions', (m) => m).indexed)
                            KListItem(
                              title:
                                  'Version ${v.integer('version')}${v.strOrNull('number') == null ? '' : ' · ${v.str('number')}'}',
                              subtitle: v.str('status') == 'final'
                                  ? 'Final ${fmtDate(DateTime.tryParse(v.str('finalAt')))}'
                                  : 'Draft',
                              divider: i < p.list('versions', (m) => m).length - 1,
                              chevron: false,
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              ],
              const SizedBox(height: KSpace.s6),
              if (canMake && !isFinal) ...[
                KButton(
                  draft ? 'Save the draft' : 'Make a draft',
                  variant: KButtonVariant.secondary,
                  fullWidth: true,
                  loading: _busy,
                  onPressed: () => _act('Draft saved', () => _api.post(_withRef(_base), {'options': _options})),
                ),
                const SizedBox(height: KSpace.s2),
                KButton(
                  'Make final',
                  icon: KIcons.lock,
                  fullWidth: true,
                  onPressed: _busy || missing > 0 || paper == null || !draft
                      ? null
                      : () async {
                          final ok = await showKConfirm(
                            context,
                            title: 'Make ${p.str('label')} final?',
                            message: 'Its number is locked and it prints exactly as it is now. Changes later make a new version.',
                            confirmLabel: 'Make final',
                          );
                          if (ok == true) {
                            await _act(
                              'Made final',
                              () => _api.post('/api/papers/${paper.str('id')}/final', {'options': _options}),
                            );
                          }
                        },
                ),
                if (paper == null || !draft)
                  Padding(
                    padding: const EdgeInsets.only(top: KSpace.s2),
                    child: Text(
                      missing > 0 ? 'Add what is missing first.' : 'Make a draft first, then make it final.',
                      textAlign: TextAlign.center,
                      style: KType.footnote.copyWith(color: c.inkMuted),
                    ),
                  ),
                if (draft) ...[
                  const SizedBox(height: KSpace.s2),
                  KButton(
                    'Delete the draft',
                    variant: KButtonVariant.tertiary,
                    fullWidth: true,
                    onPressed: _busy
                        ? null
                        : () => _act('Draft deleted', () => _api.delete('/api/papers/${paper!.str('id')}')),
                  ),
                ],
              ],
              if (canMake && isFinal)
                KButton(
                  'Make a new version',
                  variant: KButtonVariant.secondary,
                  fullWidth: true,
                  loading: _busy,
                  onPressed: () =>
                      _act('New version drafted', () => _api.post(_withRef('$_base/again'), {'ref': ?widget.paperRef})),
                ),
              const SizedBox(height: KSpace.s2),
              KButton(
                'View and print on the web',
                icon: KIcons.globe,
                variant: KButtonVariant.tertiary,
                fullWidth: true,
                onPressed: () => openLink(context, _api, '/orders/${widget.orderId}/papers/${widget.kind}'),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Future<void> _fix(BuildContext context, Json check, Json p) async {
    final fix = check.str('fix');
    final meta = p.objAt('fixes')?.objAt(fix);
    final saved = await showKSheet<bool>(
      context,
      title: meta?.strOrNull('label') ?? check.str('label'),
      builder: (_) => _FixForm(
        path: _withRef('$_base/fix'),
        field: fix,
        label: meta?.strOrNull('label') ?? check.str('label'),
        date: meta?.strOrNull('type') == 'date',
        saves: meta?.strOrNull('saves'),
      ),
    );
    if (saved == true) ref.invalidate(paperChecksProvider(_k));
  }
}

class _FixForm extends ConsumerStatefulWidget {
  const _FixForm({required this.path, required this.field, required this.label, required this.date, this.saves});
  final String path, field, label;
  final bool date;
  final String? saves;

  @override
  ConsumerState<_FixForm> createState() => _FixFormState();
}

class _FixFormState extends ConsumerState<_FixForm> {
  final _ctl = TextEditingController();
  DateTime? _day;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _ctl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final value = widget.date ? isoDay(_day) : _ctl.text.trim();
    if (value == null || value.isEmpty) {
      setState(() => _error = widget.date ? 'Choose the day.' : 'Type the ${widget.label}.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(sessionProvider.notifier).api.post(widget.path, {'field': widget.field, 'value': value});
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      setState(() {
        _busy = false;
        _error = e.message;
      });
    }
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      if (widget.saves != null)
        Text(
          'Saved on ${widget.saves}, so every paper uses it.',
          style: KType.callout.copyWith(color: context.k.inkMuted),
        ),
      const SizedBox(height: KSpace.s4),
      if (widget.date)
        KSelectField(
          label: widget.label,
          value: fmtDate(_day),
          icon: KIcons.calendar,
          error: _error,
          onTap: () async {
            final d = await showDatePicker(
              context: context,
              initialDate: _day ?? CompanyTime.today(),
              firstDate: DateTime(2020),
              lastDate: DateTime(2035),
            );
            if (d != null) setState(() => _day = d);
          },
        )
      else
        KTextField(label: widget.label, controller: _ctl, error: _error),
      const SizedBox(height: KSpace.s5),
      KButton('Save', fullWidth: true, loading: _busy, onPressed: _save),
    ],
  );
}
