import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/api.dart';
import '../../../core/company_time.dart';
import '../../../core/format.dart';
import '../../../core/json.dart';
import '../../../core/providers.dart';
import '../../../design/design.dart';

const _via = {'email': 'Email', 'whatsapp': 'WhatsApp', 'wechat': 'WeChat', 'in_person': 'In person', 'other': 'Other'};

/// What can be done with the latest revision: edit a draft, mark it sent, record the answer
/// (accepted makes the order), or start the next revision.
class QuoteActions extends ConsumerStatefulWidget {
  const QuoteActions({
    super.key,
    required this.inquiryId,
    required this.latest,
    required this.canStart,
    required this.onChanged,
  });
  final String inquiryId;
  final Json? latest;
  final bool canStart;
  final VoidCallback onChanged;

  @override
  ConsumerState<QuoteActions> createState() => _QuoteActionsState();
}

class _QuoteActionsState extends ConsumerState<QuoteActions> {
  bool _won = false;

  Api get _api => ref.read(sessionProvider.notifier).api;

  Future<void> _move(String to, Map<String, Object?> extra, String done) async {
    try {
      await _api.post('/api/revisions/${widget.latest!.str('id')}/status', {'to': to, ...extra});
      if (to == 'accepted') {
        KHaptics.success();
        setState(() => _won = true);
      }
      if (mounted) showKToast(context, done, icon: KIcons.check);
      widget.onChanged();
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, icon: KIcons.error);
    }
  }

  Future<void> _sent() async {
    var via = 'email';
    var on = CompanyTime.today();
    final ok = await showKSheet<bool>(
      context,
      title: 'Sent to the customer',
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Wrap(
              spacing: KSpace.s2,
              runSpacing: KSpace.s2,
              children: [
                for (final e in _via.entries)
                  KChip(e.value, selected: via == e.key, onPressed: () => set(() => via = e.key)),
              ],
            ),
            const SizedBox(height: KSpace.s4),
            KSelectField(
              label: 'On',
              value: fmtDate(on),
              icon: KIcons.calendar,
              onTap: () async {
                final d = await showDatePicker(
                  context: ctx,
                  initialDate: on,
                  firstDate: DateTime(2020),
                  lastDate: CompanyTime.today(),
                );
                if (d != null) set(() => on = d);
              },
            ),
            const SizedBox(height: KSpace.s5),
            KButton('Mark as sent', fullWidth: true, onPressed: () => Navigator.pop(ctx, true)),
          ],
        ),
      ),
    );
    if (ok == true) await _move('sent', {'via': via, 'on': isoDay(on)}, 'Marked as sent');
  }

  Future<void> _accepted() async {
    final r = await showKSheet<({String optionId, String customerRef})>(
      context,
      title: 'The customer accepted',
      builder: (_) => _AcceptForm(revision: widget.latest!),
    );
    if (r != null) {
      await _move('accepted', {
        'optionId': r.optionId,
        if (r.customerRef.isNotEmpty) 'customerRef': r.customerRef,
      }, 'Deal won. The order is made.');
    }
  }

  Future<void> _rejected() async {
    final reason = await showKSheet<String>(
      context,
      title: 'The customer said no',
      builder: (_) => const _RejectForm(),
    );
    if (reason != null) await _move('rejected', {if (reason.isNotEmpty) 'reason': reason}, 'Marked as rejected');
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(sessionProvider);
    if (!s.can('quotations.manage')) return const SizedBox.shrink();
    final r = widget.latest;
    final status = r?.strOrNull('status');
    final buttons = <Widget>[
      if (status == 'draft') ...[
        KButton(
          'Edit the draft',
          icon: KIcons.edit,
          variant: KButtonVariant.secondary,
          fullWidth: true,
          onPressed: () async {
            await context.push('/sales/inquiry/${widget.inquiryId}/quote?rev=${r!.str('id')}');
            widget.onChanged();
          },
        ),
        KButton('Mark as sent', icon: KIcons.mail, fullWidth: true, onPressed: _sent),
      ],
      if (status == 'sent') ...[
        Celebrate(
          play: _won,
          child: KButton('Accepted', icon: KIcons.success, fullWidth: true, onPressed: _accepted),
        ),
        KButton('Rejected', variant: KButtonVariant.secondary, fullWidth: true, onPressed: _rejected),
        KButton(
          'Expired',
          variant: KButtonVariant.tertiary,
          fullWidth: true,
          onPressed: () => _move('expired', {}, 'Marked as expired'),
        ),
      ],
      if (status != 'draft' && widget.canStart)
        KButton(
          r == null ? 'Make the quotation' : 'New revision',
          icon: KIcons.plus,
          variant: KButtonVariant.secondary,
          fullWidth: true,
          onPressed: () async {
            await context.push('/sales/inquiry/${widget.inquiryId}/quote');
            widget.onChanged();
          },
        ),
    ];
    if (buttons.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: KSpace.s3),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final b in buttons)
            Padding(
              padding: const EdgeInsets.only(bottom: KSpace.s2),
              child: b,
            ),
        ],
      ),
    );
  }
}

/// Which option they chose and their reference; owns its field.
class _AcceptForm extends StatefulWidget {
  const _AcceptForm({required this.revision});
  final Json revision;

  @override
  State<_AcceptForm> createState() => _AcceptFormState();
}

class _AcceptFormState extends State<_AcceptForm> {
  late final List<Json> _options = widget.revision.list('options', (m) => m);
  late String? _optionId = _options.length == 1 ? _options.first.strOrNull('id') : null;
  final _ref = TextEditingController();

  @override
  void dispose() {
    _ref.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Text(
        'This makes the order from the option they chose.',
        style: KType.callout.copyWith(color: context.k.inkMuted),
      ),
      if (_options.length > 1) ...[
        const SizedBox(height: KSpace.s3),
        for (final o in _options)
          KRadio<String>(
            label: 'Option ${o.str('letter')}',
            help: fmtMoney(o.strOrNull('total'), widget.revision.strOrNull('currency')),
            value: o.str('id'),
            group: _optionId,
            onChanged: (v) => setState(() => _optionId = v),
          ),
      ],
      const SizedBox(height: KSpace.s4),
      KTextField(label: 'Their PO or reference', controller: _ref, optional: true),
      const SizedBox(height: KSpace.s5),
      KButton(
        'Accepted · make the order',
        fullWidth: true,
        onPressed: _optionId == null
            ? null
            : () => Navigator.pop(context, (optionId: _optionId!, customerRef: _ref.text.trim())),
      ),
    ],
  );
}

/// Why they said no (optional); owns its field.
class _RejectForm extends StatefulWidget {
  const _RejectForm();

  @override
  State<_RejectForm> createState() => _RejectFormState();
}

class _RejectFormState extends State<_RejectForm> {
  final _why = TextEditingController();

  @override
  void dispose() {
    _why.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      KTextField(
        label: 'Why',
        controller: _why,
        optional: true,
        multiline: true,
        hint: 'Price too high; bought locally',
      ),
      const SizedBox(height: KSpace.s5),
      KButton(
        'Mark as rejected',
        variant: KButtonVariant.danger,
        fullWidth: true,
        onPressed: () => Navigator.pop(context, _why.text.trim()),
      ),
    ],
  );
}
