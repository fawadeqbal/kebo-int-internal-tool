import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/api.dart';
import '../../../core/company_time.dart';
import '../../../core/format.dart';
import '../../../core/json.dart';
import '../../../core/links.dart';
import '../../../core/providers.dart';
import '../../../core/send.dart';
import '../../../design/design.dart';
import '../../money/presentation/money_forms.dart';
import '../data/orders_data.dart';

/// One order: its identity and money at the top, what it needs now, where each stage
/// stands, the lines, the papers and the files. Delivery and SAT are confirmed here.
class OrderScreen extends ConsumerWidget {
  const OrderScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final order = ref.watch(orderProvider(id));
    void reload() {
      ref.invalidate(orderProvider(id));
      ref.invalidate(ordersProvider);
    }

    return Scaffold(
      backgroundColor: context.k.bg,
      appBar: KTopBar(
        title: 'Order',
        actions: [
          if (order.value != null)
            KIconButton(
              KIcons.globe,
              label: 'Open on the web',
              onPressed: () => openLink(context, ref.read(sessionProvider.notifier).api, '/orders/$id'),
            ),
        ],
      ),
      body: switch (order) {
        AsyncValue(:final value?) => RefreshIndicator(
          onRefresh: () async => reload(),
          child: _Body(o: value, onChanged: reload),
        ),
        AsyncValue(:final error?) => Padding(
          padding: const EdgeInsets.all(KSpace.s4),
          child: KBanner(
            error.toString(),
            tone: KTone.danger,
            title: "Couldn't open this order",
            actionLabel: 'Try again',
            onAction: reload,
          ),
        ),
        _ => const Padding(
          padding: EdgeInsets.all(KSpace.s4),
          child: Column(
            children: [
              KSkeleton(height: 180),
              SizedBox(height: KSpace.s4),
              KSkeleton(height: 140),
            ],
          ),
        ),
      },
    );
  }
}

class _Body extends ConsumerWidget {
  const _Body({required this.o, required this.onChanged});
  final OrderView o;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.k;
    final s = ref.watch(sessionProvider);
    final cur = o.currency;
    final total = num.tryParse(o.total ?? '') ?? 0, received = num.tryParse(o.received ?? '') ?? 0;
    final wordAt = OrderWord.order.indexOf(o.word ?? '');
    final delivery = o.stands.where((x) => x.str('stage') == 'delivery').firstOrNull;
    return ListView(
      padding: const EdgeInsets.only(bottom: KSpace.s16),
      children: [
        KRecordHeader(
          type: 'Sales order',
          number: o.refNo,
          icon: KIcons.box,
          title: o.what ?? o.refNo,
          party: o.customer,
          badges: [
            OrderWord.badge(o.word),
            if (o.late) const KBadge('Late', tone: KTone.danger),
          ],
          figures: [
            KFigure('Total', fmtMoney(o.total, cur) ?? ''),
            KFigure(
              'Received',
              fmtMoney(o.received, cur) ?? '',
              tone: received >= total && total > 0 ? KTone.success : null,
            ),
            KFigure(
              'Due',
              fmtMoney(o.due, cur) ?? '',
              tone: (num.tryParse(o.due ?? '') ?? 0) > 0 && o.late ? KTone.danger : null,
            ),
          ],
          steps: o.status == 'cancelled'
              ? null
              : KSteps(
                  steps: [
                    for (final (i, w) in OrderWord.order.indexed)
                      (
                        w,
                        i < wordAt || o.word == 'Done'
                            ? KStepState.done
                            : i == wordAt
                            ? (o.late ? KStepState.blocked : KStepState.current)
                            : KStepState.todo,
                      ),
                  ],
                ),
          updated: o.inquiryId == null ? null : 'From an inquiry · tap below to open it',
        ),
        Padding(
          padding: const EdgeInsets.all(KSpace.s4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (o.needs != null) ...[
                KBanner(
                  '${o.needs}${o.needsDue == null ? '' : ', by ${fmtDate(DateTime.tryParse(o.needsDue!))}'}.${o.nextHint == null ? '' : ' ${o.nextHint}'}',
                  tone: o.late ? KTone.danger : KTone.info,
                  title: o.late ? 'Late' : 'Next',
                ),
                const SizedBox(height: KSpace.s4),
              ],
              if (o.stands.isNotEmpty) ...[
                KSection(
                  title: 'Where it stands',
                  children: [
                    KCard(
                      padding: EdgeInsets.zero,
                      child: Column(
                        children: [
                          for (final (i, x) in o.stands.indexed)
                            KListItem(
                              title: x.str('label'),
                              subtitle: x.strOrNull('fact'),
                              meta: x.strOrNull('missing'),
                              status: KBadge(x.str('word'), tone: toneOf(x.strOrNull('tone'))),
                              divider: i < o.stands.length - 1,
                              chevron: false,
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: KSpace.s6),
              ],
              KDetails(
                title: 'Money',
                items: [
                  KDetail('Order total', fmtMoney(o.total, cur), emphasis: true),
                  KDetail('Received', fmtMoney(o.received, cur), emphasis: true),
                  KDetail('Advance${o.depositPercent > 0 ? ' (${o.depositPercent}%)' : ''}', fmtMoney(o.deposit, cur)),
                  KDetail('Still due', fmtMoney(o.due, cur)),
                  KDetail('Bank charges', fmtMoney(o.bankCharges, cur)),
                ],
              ),
              if (total > 0) ...[
                const SizedBox(height: KSpace.s2),
                KProgress(
                  value: received / total,
                  label: 'Received',
                  tone: received >= total ? KTone.success : KTone.brand,
                ),
              ],
              if (o.status == 'open') ...[
                const SizedBox(height: KSpace.s3),
                Row(
                  children: [
                    Expanded(
                      child: KButton(
                        'Money received',
                        icon: KIcons.arrowIn,
                        variant: KButtonVariant.secondary,
                        fullWidth: true,
                        onPressed: () async {
                          if (await openMoneyReceived(
                            context,
                            orderId: o.id,
                            refNo: o.refNo,
                            currency: o.currency ?? 'USD',
                            due: o.due,
                          )) {
                            onChanged();
                          }
                        },
                      ),
                    ),
                    const SizedBox(width: KSpace.s2),
                    Expanded(
                      child: KButton(
                        'Expense',
                        icon: KIcons.plus,
                        variant: KButtonVariant.secondary,
                        fullWidth: true,
                        onPressed: () async {
                          if (await openExpense(context, orderId: o.id, refNo: o.refNo)) onChanged();
                        },
                      ),
                    ),
                  ],
                ),
              ],
              const SizedBox(height: KSpace.s6),
              KSection(
                title: 'Lines',
                caption: '${o.lines.length}',
                children: [
                  KCard(
                    padding: EdgeInsets.zero,
                    child: o.lines.isEmpty
                        ? const KEmptyState(
                            icon: KIcons.box,
                            title: 'No lines',
                            message: 'The lines come from the accepted quotation.',
                          )
                        : Column(
                            children: [
                              for (final (i, l) in o.lines.indexed)
                                KListItem(
                                  leading: SizedBox(
                                    width: 28,
                                    child: Text(
                                      l.str('no', '${i + 1}'),
                                      style: KType.label.copyWith(color: c.inkMuted),
                                    ),
                                  ),
                                  title: l.str('description'),
                                  subtitle: [
                                    if (l.strOrNull('model') != null) 'Model ${l.str('model')}',
                                    '${l.str('quantity')} ${l.str('unit')}',
                                  ].join(' · '),
                                  trailing: Text(
                                    fmtMoney(l.strOrNull('lineTotal'), null) ?? '',
                                    style: KType.callout.copyWith(
                                      color: c.ink,
                                      fontFeatures: const [FontFeature.tabularFigures()],
                                    ),
                                  ),
                                  divider: i < o.lines.length - 1,
                                ),
                            ],
                          ),
                  ),
                ],
              ),
              const SizedBox(height: KSpace.s6),
              KSection(
                title: 'Papers',
                children: [
                  KCard(
                    padding: EdgeInsets.zero,
                    child: o.papers.isEmpty
                        ? const KEmptyState(
                            icon: KIcons.file,
                            title: 'No papers yet',
                            message: 'Contracts, invoices and shipping papers show here as they are made or uploaded.',
                          )
                        : Column(
                            children: [
                              for (final (i, p) in o.papers.indexed)
                                KListItem(
                                  leading: KIcon(KIcons.file, color: c.inkMuted),
                                  title: p.str('label', p.str('name')),
                                  subtitle: [p.strOrNull('number'), p.strOrNull('sub')].whereType<String>().join(' · '),
                                  status: _paperState(p.str('state')),
                                  divider: i < o.papers.length - 1,
                                  chevron: false,
                                ),
                            ],
                          ),
                  ),
                ],
              ),
              const SizedBox(height: KSpace.s6),
              KSection(
                title: 'Files',
                caption: o.files.isEmpty ? null : '${o.files.length}',
                children: [
                  KCard(
                    padding: EdgeInsets.zero,
                    child: o.files.isEmpty
                        ? const KEmptyState(
                            icon: KIcons.upload,
                            title: 'No files',
                            message: 'Photos, scans and proofs added to this order show here.',
                          )
                        : Column(
                            children: [
                              for (final (i, f) in o.files.take(30).indexed)
                                KListItem(
                                  leading: KIcon(_fileIcon(f.str('name')), color: c.inkMuted),
                                  title: f.str('name'),
                                  subtitle: [
                                    f.strOrNull('kindLabel') ?? f.strOrNull('stepLabel'),
                                    if (f.integer('size') > 0) _size(f.integer('size')),
                                  ].whereType<String>().join(' · '),
                                  meta: fmtWhen(f.date('at')),
                                  divider: i < o.files.length - 1,
                                  onPressed: f.strOrNull('href') == null
                                      ? null
                                      : () => openFile(context, s.api, f.str('href'), f.str('name')),
                                ),
                            ],
                          ),
                  ),
                ],
              ),
              if (delivery != null && o.status == 'open') ...[
                const SizedBox(height: KSpace.s6),
                KSection(
                  title: 'Delivery & SAT',
                  children: [
                    KCard(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Text(
                                  delivery.strOrNull('fact') ?? 'Not delivered yet',
                                  style: KType.body.copyWith(color: c.ink),
                                ),
                              ),
                              KBadge(delivery.str('word'), tone: toneOf(delivery.strOrNull('tone'))),
                            ],
                          ),
                          const SizedBox(height: KSpace.s4),
                          KButton(
                            'Delivered in full',
                            icon: KIcons.check,
                            variant: KButtonVariant.secondary,
                            fullWidth: true,
                            onPressed: () => _confirm(context, ref, 'delivered'),
                          ),
                          const SizedBox(height: KSpace.s2),
                          KButton(
                            'SAT passed',
                            icon: KIcons.shield,
                            variant: KButtonVariant.secondary,
                            fullWidth: true,
                            onPressed: () => _confirm(context, ref, 'sat'),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ],
              if (o.inquiryId != null) ...[
                const SizedBox(height: KSpace.s6),
                KButton(
                  'Open the inquiry',
                  icon: KIcons.chart,
                  variant: KButtonVariant.tertiary,
                  fullWidth: true,
                  onPressed: () => context.push('/sales/inquiry/${o.inquiryId}'),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }

  Future<void> _confirm(BuildContext context, WidgetRef ref, String what) async {
    final ok = await showKSheet<bool>(
      context,
      title: what == 'sat' ? 'SAT passed' : 'Delivered in full',
      builder: (_) => _DeliveryForm(o: o, what: what),
    );
    if (ok == true) onChanged();
  }

  static Widget _paperState(String state) => switch (state) {
    'final' || 'sent' || 'uploaded' || 'kept' => KBadge(
      state == 'kept'
          ? 'Kept elsewhere'
          : state == 'uploaded'
          ? 'In'
          : state == 'sent'
          ? 'Sent'
          : 'Final',
      tone: KTone.success,
    ),
    'draft' => const KBadge('Draft'),
    'missing' || 'needed' => const KBadge('Needed', tone: KTone.warning),
    _ => KBadge(state.isEmpty ? 'Not yet' : state),
  };

  static KIconData _fileIcon(String name) {
    final ext = name.contains('.') ? name.split('.').last.toLowerCase() : '';
    return switch (ext) {
      'jpg' || 'jpeg' || 'png' || 'heic' || 'webp' => KIcons.camera,
      'mp4' || 'mov' => KIcons.play,
      _ => KIcons.file,
    };
  }

  static String _size(int b) =>
      b < 1024 * 1024 ? '${(b / 1024).round()} KB' : '${(b / 1024 / 1024).toStringAsFixed(1)} MB';
}

/// "Delivered in full" / "SAT passed": the day, and who signed for SAT. Kept on the phone
/// when there's no signal.
class _DeliveryForm extends ConsumerStatefulWidget {
  const _DeliveryForm({required this.o, required this.what});
  final OrderView o;
  final String what;

  @override
  ConsumerState<_DeliveryForm> createState() => _DeliveryFormState();
}

class _DeliveryFormState extends ConsumerState<_DeliveryForm> {
  DateTime _on = CompanyTime.today();
  final _by = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _by.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final sat = widget.what == 'sat';
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final s = ref.read(sessionProvider.notifier);
      await sendOrKeep(
        context,
        s,
        '${sat ? 'SAT passed' : 'Delivered in full'} · ${widget.o.refNo}',
        'POST',
        '/api/orders/${widget.o.id}/${sat ? 'sat/all-passed' : 'delivery/all-good'}',
        sat
            ? {'satOn': isoDay(_on), if (_by.text.trim().isNotEmpty) 'satSignedBy': _by.text.trim()}
            : {'deliveredOn': isoDay(_on)},
      );
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = e.message;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final sat = widget.what == 'sat';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          sat ? 'Every SAT check is marked passed.' : 'Every line is marked delivered in full and in good condition.',
          style: KType.callout.copyWith(color: context.k.inkMuted),
        ),
        const SizedBox(height: KSpace.s4),
        if (_error != null) ...[KBanner(_error!, tone: KTone.danger), const SizedBox(height: KSpace.s3)],
        KSelectField(
          label: sat ? 'SAT on' : 'Delivered on',
          value: fmtDate(_on),
          icon: KIcons.calendar,
          onTap: () async {
            final d = await showDatePicker(
              context: context,
              initialDate: _on,
              firstDate: DateTime(2020),
              lastDate: CompanyTime.today(),
            );
            if (d != null) setState(() => _on = d);
          },
        ),
        if (sat) ...[
          const SizedBox(height: KSpace.s4),
          KTextField(label: 'Signed by (the customer)', controller: _by, optional: true),
        ],
        const SizedBox(height: KSpace.s6),
        KButton(sat ? 'Mark SAT passed' : 'Mark delivered', fullWidth: true, loading: _busy, onPressed: _save),
      ],
    );
  }
}
