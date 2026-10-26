import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api.dart';
import '../../core/format.dart' as f;
import '../../core/json.dart';
import '../../core/refresh.dart';
import '../../core/session.dart';
import '../../theme/colors.dart';
import '../../ui/kit.dart';

/// Whether the rebate paperwork can be changed here: the person may change orders and the
/// order is not cancelled (the server refuses a cancelled one).
bool canEditRebate(Json order, Session session) => session.can('orders.update') && order.s('status') != 'cancelled';

/// "Export rebate" (`tax` of GET /orders/:id): the tax expected back on the goods, the factory's
/// VAT invoice and the filing (within 90 days of shipping), each a switch with its date.
class RebateCard extends ConsumerWidget {
  const RebateCard({super.key, required this.o});
  final Json o;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tax = o.mn('tax');
    if (tax == null) return const SizedBox.shrink(); // an older server
    final c = context.c;
    final rebate = tax.l('rebate').where((r) => f.toCents(r['amount']) != 0).toList();
    final invoiceOn = tax.sn('vatInvoiceReceivedOn');
    final filedOn = tax.sn('rebateFiledOn');
    final deadline = tax.sn('deadline');
    final needs = tax.mn('needs');
    final late = needs?.b('late') ?? false;

    if (rebate.isEmpty && invoiceOn == null && filedOn == null) {
      return SectionCard(
        key: const ValueKey('rebate'),
        title: 'Export rebate',
        child: Text('No export rebate on this order', style: context.t.bodyMedium!.copyWith(color: c.muted)),
      );
    }

    final edit = canEditRebate(o, ref.watch(sessionProvider));
    return SectionCard(
      key: const ValueKey('rebate'),
      title: 'Export rebate',
      subtitle: deadline != null ? 'File by ${f.date(deadline)}' : 'File within 90 days of shipping',
      trailing: filedOn != null ? const ToneBadge('Filed', tone: Tone.ok) : (late ? const ToneBadge('Late', tone: Tone.bad) : null),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (needs != null)
          Padding(
            key: const ValueKey('rebate-needs'),
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Icon(late ? Icons.schedule_rounded : Icons.flag_outlined, size: 18, color: late ? c.bad : c.primary),
              gap8,
              Expanded(
                child: Text(
                  needs.s('title'),
                  style: context.t.bodyMedium!.copyWith(fontWeight: FontWeight.w600, color: late ? c.bad : null),
                ),
              ),
            ]),
          ),
        if (rebate.isNotEmpty)
          KeyValues([
            (
              'Expected rebate',
              Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                for (final r in rebate) MoneyText(r['amount'], r.s('currency', 'CNY'), key: ValueKey('rebate-${r.s('currency')}')),
              ]),
            ),
          ]),
        Divider(height: 1, color: c.line),
        RebateStep(order: o, field: 'vatInvoiceReceivedOn', label: "Factory's VAT invoice received", on: invoiceOn, edit: edit),
        Divider(height: 1, color: c.line),
        RebateStep(order: o, field: 'rebateFiledOn', label: 'Rebate filed', on: filedOn, edit: edit),
      ]),
    );
  }
}

/// One piece of the paperwork: a switch (on = today) with its date, which can be changed.
class RebateStep extends ConsumerStatefulWidget {
  const RebateStep({super.key, required this.order, required this.field, required this.label, required this.on, required this.edit});
  final Json order;

  /// `vatInvoiceReceivedOn` or `rebateFiledOn`.
  final String field;
  final String label;
  final String? on;
  final bool edit;

  @override
  ConsumerState<RebateStep> createState() => _RebateStepState();
}

class _RebateStepState extends ConsumerState<RebateStep> {
  bool _busy = false;

  Future<void> _save(String? on) async {
    setState(() => _busy = true);
    try {
      await saveRebateDate(context, ref, widget.order.s('id'), widget.field, on);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Another day than today (never in the future).
  Future<void> _pick() async {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final current = f.parseDate(widget.on);
    final picked = await showDatePicker(
      context: context,
      initialDate: current == null || current.isAfter(today) ? today : current,
      firstDate: DateTime(now.year - 5),
      lastDate: today,
      helpText: widget.label,
    );
    if (picked != null && mounted && f.isoDate(picked) != widget.on) await _save(f.isoDate(picked));
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final on = widget.on;
    final date = on == null
        ? Text('Not yet', style: context.t.bodySmall)
        : widget.edit
            ? InkWell(
                key: ValueKey('rebate-date-${widget.field}'),
                borderRadius: BorderRadius.circular(6),
                onTap: _busy ? null : _pick,
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                    Text(f.date(on), style: context.t.bodySmall!.copyWith(color: c.primary, fontWeight: FontWeight.w600)),
                    const SizedBox(width: 4),
                    Icon(Icons.edit_calendar_outlined, size: 14, color: c.primary),
                  ]),
                ),
              )
            : Text(f.date(on), style: context.t.bodySmall);
    return Padding(
      key: ValueKey('rebate-${widget.field}'),
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(children: [
        Icon(on != null ? Icons.check_circle_rounded : Icons.radio_button_unchecked_rounded, size: 18, color: on != null ? c.ok : c.muted),
        gap8,
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(widget.label, style: context.t.bodyMedium!.copyWith(fontWeight: FontWeight.w600)),
            date,
          ]),
        ),
        if (widget.edit)
          _busy
              ? const Padding(padding: EdgeInsets.all(14), child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)))
              : Switch(
                  key: ValueKey('rebate-switch-${widget.field}'),
                  value: on != null,
                  onChanged: (v) => _save(v ? f.today() : null),
                ),
      ]),
    );
  }
}

/// PATCH /orders/:id/tax with one date ("YYYY-MM-DD", or null to clear), then the order reloads.
/// A refusal (e.g. a date in the future, a cancelled order) is shown as a message.
Future<bool> saveRebateDate(BuildContext context, WidgetRef ref, String orderId, String field, String? on) async {
  try {
    await ref.mutate(() => ref.read(repoProvider).setOrderTax(orderId, field, on));
    return true;
  } on ApiException catch (e) {
    if (context.mounted) toast(context, e.message, error: true);
    return false;
  }
}
