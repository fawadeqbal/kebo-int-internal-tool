import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api.dart';
import '../../core/format.dart' as f;
import '../../core/json.dart';
import '../../core/refresh.dart';
import '../../core/session.dart';
import '../../theme/colors.dart';
import '../../ui/docs.dart';
import '../../ui/kit.dart';
import 'order_detail.dart' show documentPdf;

/// The order's goods lines (`lines[]` with type "goods"). Charges are not received from a factory.
List<Json> goodsLines(Json order) => order.l('lines').where((l) => l.s('type') == 'goods').toList();

/// The first line of a description (the rest is the spec).
String lineTitle(Json line) {
  final d = line.s('description').trim();
  final first = d.split('\n').first.trim();
  return first.isEmpty ? 'Item' : first;
}

/// Whether received goods can be recorded: the person may change orders, and the order is
/// neither cancelled nor Done.
bool canRecordGoods(Json order, Session session) =>
    session.can('orders.update') && order.s('status') != 'cancelled' && order.s('stage') != 'done';

/// "Goods from the factory": each goods line with how many came in (60 / 100 pcs, a bar and the
/// day), "Record received" and "All received" for the warehouse, then the packing list line.
class GoodsCard extends ConsumerWidget {
  const GoodsCard({super.key, required this.o});
  final Json o;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final lines = goodsLines(o);
    if (lines.isEmpty) return const SizedBox.shrink();
    final goods = o.m('goods');
    final total = goods.i('lines', lines.length);
    final complete = goods.i('received', lines.where((l) => l.n('receivedQty') >= l.n('quantity')).length);
    final allIn = goods.b('allReceived', total > 0 && complete == total);
    final edit = canRecordGoods(o, ref.watch(sessionProvider));
    return SectionCard(
      key: const ValueKey('goods'),
      title: 'Goods from the factory',
      subtitle: allIn ? 'Everything has come in' : '$complete of $total ${total == 1 ? 'item' : 'items'} complete',
      trailing: allIn ? const ToneBadge('All in', tone: Tone.ok) : null,
      padding: EdgeInsets.zero,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        CardList(children: [for (final l in lines) GoodsLineTile(l)]),
        if (edit)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: Row(children: [
              Expanded(
                child: SizedBox(
                  height: 52,
                  child: BusyButton(
                    key: const ValueKey('record-received'),
                    label: 'Record received',
                    icon: Icons.edit_note_rounded,
                    style: BusyStyle.outlined,
                    onPressed: () => recordReceived(context, ref, o),
                  ),
                ),
              ),
              if (!allIn) ...[
                gap12,
                Expanded(
                  child: SizedBox(
                    height: 52,
                    child: BusyButton(
                      key: const ValueKey('all-received'),
                      label: 'All received',
                      icon: Icons.done_all_rounded,
                      onPressed: () => markAllReceived(context, ref, o),
                    ),
                  ),
                ),
              ],
            ]),
          ),
        PackingListLine(o: o),
      ]),
    );
  }
}

/// One goods line: what it is, the factory, "60 / 100 pcs", a bar and the day it came in.
class GoodsLineTile extends StatelessWidget {
  const GoodsLineTile(this.l, {super.key});
  final Json l;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final qty = l.n('quantity');
    final got = l.n('receivedQty');
    final done = qty > 0 && got >= qty;
    final factory = l.mn('factory')?.sn('name');
    final on = l.sn('receivedOn');
    final unit = l.s('unit');
    return Padding(
      key: ValueKey('goods-${l.s('id')}'),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(lineTitle(l), maxLines: 2, overflow: TextOverflow.ellipsis, style: context.t.bodyMedium!.copyWith(fontWeight: FontWeight.w600)),
        if (factory != null) Padding(padding: const EdgeInsets.only(top: 2), child: Text('from $factory', style: context.t.bodySmall)),
        const SizedBox(height: 8),
        Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Text(
            '${f.qty(l['receivedQty'])} / ${f.qty(l['quantity'])}${unit.isEmpty ? '' : ' $unit'}',
            style: TextStyle(fontFamily: 'Geist', fontSize: 17, fontWeight: FontWeight.w700, color: done ? c.ok : c.text, fontFeatures: const [FontFeature.tabularFigures()]),
          ),
          const Spacer(),
          Text(
            on != null ? f.date(on) : (got > 0 ? '' : 'Not in yet'),
            style: context.t.bodySmall,
          ),
        ]),
        const SizedBox(height: 6),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(
            value: qty > 0 ? (got / qty).clamp(0, 1).toDouble() : 0,
            minHeight: 8,
            backgroundColor: c.line,
            color: done ? c.ok : c.primarySolid,
            semanticsLabel: '${lineTitle(l)} received',
          ),
        ),
      ]),
    );
  }
}

/// The packing list (filled in on the web): ready with its totals and PDF, or not made yet.
class PackingListLine extends StatelessWidget {
  const PackingListLine({super.key, required this.o});
  final Json o;

  @override
  Widget build(BuildContext context) {
    final goods = o.m('goods');
    final c = context.c;
    if (!goods.b('packed')) {
      return Padding(
        key: const ValueKey('packing'),
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
        child: Row(children: [
          Icon(Icons.inventory_2_outlined, size: 18, color: c.muted),
          gap8,
          Expanded(child: Text('Packing list: not made yet (fill it in on the web)', style: context.t.bodyMedium!.copyWith(color: c.text2))),
        ]),
      );
    }
    final t = goods.m('totals');
    final packages = t.i('packages');
    final doc = o.l('documents').firstWhere((d) => d.s('kind') == 'packing-list', orElse: () => {'kind': 'packing-list', 'label': 'Packing list'});
    final pdf = documentPdf(o, doc);
    return Padding(
      key: const ValueKey('packing'),
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(Icons.inventory_2_rounded, size: 18, color: c.ok),
          gap8,
          Expanded(
            child: Text(
              'Packing list ready — $packages ${packages == 1 ? 'package' : 'packages'}, ${f.amount(t['grossWeightKg'])} kg, ${f.qty(t['cbm'])} CBM',
              style: context.t.bodyMedium!.copyWith(fontWeight: FontWeight.w600),
            ),
          ),
        ]),
        if (goods.sn('containerNo') != null) Padding(padding: const EdgeInsets.only(left: 26, top: 2), child: Text('Container ${goods.s('containerNo')}', style: context.t.bodySmall)),
        gap8,
        SizedBox(
          height: 48,
          child: OutlinedButton.icon(
            key: const ValueKey('packing-pdf'),
            onPressed: () => openPdf(context, kind: pdf.kind, id: pdf.id, fileName: pdf.fileName),
            icon: const Icon(Icons.picture_as_pdf_outlined, size: 18),
            label: const Text('Open the packing list (PDF)'),
          ),
        ),
      ]),
    );
  }
}

/* ---------------------------------------------------------------- actions */

/// One tap: every goods line came in in full, today.
Future<void> markAllReceived(BuildContext context, WidgetRef ref, Json o) async {
  final lines = goodsLines(o);
  final repo = ref.read(repoProvider);
  try {
    await ref.mutate(() => repo.recordReceipt(o.s('id'), {for (final l in lines) l.s('id'): l.n('quantity')}, on: f.today()));
    if (context.mounted) toast(context, 'All goods marked as received.');
  } on ApiException catch (e) {
    if (context.mounted) toast(context, e.message, error: true);
  }
}

/// "Record received": a sheet with one quantity per goods line and the day. Saves on the sheet,
/// so a refusal (e.g. more than ordered) is shown there and nothing is lost.
Future<void> recordReceived(BuildContext context, WidgetRef ref, Json o) async {
  final saved = await showSheet<bool>(
    context,
    title: 'Received from the factory',
    subtitle: 'How many of each have come in so far (the total, not only today).',
    builder: (_) => ReceiptForm(order: o, save: (received, on) => ref.mutate(() => ref.read(repoProvider).recordReceipt(o.s('id'), received, on: on))),
  );
  if (saved == true && context.mounted) toast(context, 'Saved what came in.');
}

/// The fields of the "Record received" sheet. [save] sends lineId → total received and the day.
class ReceiptForm extends StatefulWidget {
  const ReceiptForm({super.key, required this.order, required this.save});
  final Json order;
  final Future<Object?> Function(Map<String, num> received, String on) save;
  @override
  State<ReceiptForm> createState() => _ReceiptFormState();
}

class _ReceiptFormState extends State<ReceiptForm> {
  late final List<Json> _lines = goodsLines(widget.order);
  late final Map<String, TextEditingController> _qty = {for (final l in _lines) l.s('id'): TextEditingController(text: f.qty(l['receivedQty']).replaceAll(',', ''))};
  final Map<String, String?> _errors = {};
  String _on = f.today();
  String? _dateError;
  String? _serverError;
  bool _busy = false;

  @override
  void dispose() {
    for (final c in _qty.values) {
      c.dispose();
    }
    super.dispose();
  }

  /// The quantities, or null (with the reasons shown) when one is not right.
  Map<String, num>? _read() {
    final out = <String, num>{};
    _errors.clear();
    for (final l in _lines) {
      final id = l.s('id');
      final text = (_qty[id]?.text ?? '').trim().replaceAll(',', '');
      final v = text.isEmpty ? 0 : num.tryParse(text);
      final ordered = l.n('quantity');
      if (v == null) {
        _errors[id] = 'Type a number';
      } else if (v < 0) {
        _errors[id] = 'Cannot be negative';
      } else if (v > ordered) {
        _errors[id] = 'Only ${f.qty(l['quantity'])} ${l.s('unit')} were ordered';
      } else {
        out[id] = v;
      }
    }
    _dateError = _on.compareTo(f.today()) > 0 ? 'The date cannot be in the future.' : null;
    return _errors.isEmpty && _dateError == null ? out : null;
  }

  Future<void> _submit() async {
    final values = _read();
    setState(() => _serverError = null);
    if (values == null) return;
    setState(() => _busy = true);
    try {
      await widget.save(values, _on);
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _serverError = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      for (final l in _lines) _line(context, l),
      DateField(label: 'Date received', value: _on, error: _dateError, onChanged: (v) => setState(() => _on = v.isEmpty ? f.today() : v)),
      if (_serverError case final said?) Notice(said, tone: Tone.bad),
      SizedBox(
        height: 56,
        child: FilledButton.icon(
          key: const ValueKey('receipt-save'),
          onPressed: _busy ? null : _submit,
          icon: _busy ? SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: c.bg)) : const Icon(Icons.check_rounded, size: 20),
          label: const Text('Save', style: TextStyle(fontSize: 16)),
        ),
      ),
    ]);
  }

  Widget _line(BuildContext context, Json l) {
    final id = l.s('id');
    final ctrl = _qty[id];
    if (ctrl == null) return const SizedBox.shrink();
    final factory = l.mn('factory')?.sn('name');
    final unit = l.s('unit');
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(lineTitle(l), style: context.t.bodyLarge!.copyWith(fontWeight: FontWeight.w600)),
        Text(
          [if (factory != null) 'from $factory', '${f.qty(l['quantity'])}${unit.isEmpty ? '' : ' $unit'} ordered'].join(' · '),
          style: context.t.bodySmall,
        ),
        const SizedBox(height: 6),
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(
            child: TextField(
              key: ValueKey('qty-$id'),
              controller: ctrl,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))],
              textInputAction: TextInputAction.next,
              // One tap on the box selects the old number, so typing replaces it.
              onTap: () => ctrl.selection = TextSelection(baseOffset: 0, extentOffset: ctrl.text.length),
              onChanged: (_) {
                if (_errors[id] != null) setState(() => _errors.remove(id));
              },
              style: const TextStyle(fontFamily: 'Geist', fontSize: 20, fontWeight: FontWeight.w600),
              decoration: InputDecoration(
                suffixText: unit.isEmpty ? null : unit,
                errorText: _errors[id],
                contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
              ),
            ),
          ),
          gap8,
          SizedBox(
            height: 54,
            child: OutlinedButton(
              key: ValueKey('all-$id'),
              onPressed: () => setState(() {
                ctrl.text = f.qty(l['quantity']).replaceAll(',', '');
                _errors.remove(id);
              }),
              child: Text('All ${f.qty(l['quantity'])}'),
            ),
          ),
        ]),
      ]),
    );
  }
}
