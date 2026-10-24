import 'package:flutter/material.dart';

import '../core/format.dart' as f;
import '../core/json.dart';
import 'kit.dart';

/// One editable line: description, quantity, unit price.
class EditLine {
  EditLine({String description = '', String quantity = '1', String unitPrice = ''})
      : description = TextEditingController(text: description),
        quantity = TextEditingController(text: quantity),
        unitPrice = TextEditingController(text: unitPrice);
  final TextEditingController description, quantity, unitPrice;

  factory EditLine.fromJson(Json j) => EditLine(
        description: j.s('description'),
        quantity: f.qty(j['quantity'] ?? '1').replaceAll(',', ''),
        unitPrice: j.s('unitPrice').isEmpty ? '' : (num.tryParse(j.s('unitPrice'))?.toString() ?? j.s('unitPrice')),
      );

  Map<String, String> toJson() => {'description': description.text.trim(), 'quantity': quantity.text.trim(), 'unitPrice': unitPrice.text.trim()};
  bool get isEmpty => description.text.trim().isEmpty && unitPrice.text.trim().isEmpty;
  void dispose() {
    description.dispose();
    quantity.dispose();
    unitPrice.dispose();
  }
}

/// Lines + discount + tax with live totals (calculated exactly like the server).
class LineItemsEditor extends StatefulWidget {
  const LineItemsEditor({super.key, required this.lines, required this.discount, required this.taxRate, required this.currency, this.error});
  final List<EditLine> lines;
  final TextEditingController discount;
  final TextEditingController taxRate;
  final String currency;
  final String? error;
  @override
  State<LineItemsEditor> createState() => _LineItemsEditorState();
}

class _LineItemsEditorState extends State<LineItemsEditor> {
  void _changed(_) => setState(() {});

  @override
  Widget build(BuildContext context) {
    final cur = widget.currency;
    final t = f.lineTotals([for (final l in widget.lines) (quantity: l.quantity.text, unitPrice: l.unitPrice.text)], widget.discount.text, widget.taxRate.text);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      for (var i = 0; i < widget.lines.length; i++)
        Container(
          margin: const EdgeInsets.only(bottom: 10),
          padding: const EdgeInsets.fromLTRB(12, 10, 6, 4),
          decoration: BoxDecoration(color: context.c.surface, borderRadius: BorderRadius.circular(12), border: Border.all(color: context.c.line)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(children: [
              Text('Line ${i + 1}', style: context.t.labelMedium),
              const Spacer(),
              Text(f.cents(t.lines[i], cur), style: context.t.bodyMedium!.copyWith(fontWeight: FontWeight.w600, fontFeatures: const [FontFeature.tabularFigures()])),
              IconButton(
                visualDensity: VisualDensity.compact,
                tooltip: 'Remove line',
                onPressed: widget.lines.length == 1
                    ? null
                    : () => setState(() {
                          widget.lines.removeAt(i).dispose();
                        }),
                icon: const Icon(Icons.delete_outline_rounded, size: 20),
              ),
            ]),
            TextField(
              controller: widget.lines[i].description,
              minLines: 1,
              maxLines: 6,
              onChanged: _changed,
              decoration: const InputDecoration(hintText: 'e.g. Rotary tablet press, 35 stations, GMP, SS316'),
            ),
            gap8,
            Row(children: [
              Expanded(
                flex: 2,
                child: TextField(controller: widget.lines[i].quantity, keyboardType: const TextInputType.numberWithOptions(decimal: true), onChanged: _changed, decoration: const InputDecoration(labelText: 'Qty')),
              ),
              gap8,
              Expanded(
                flex: 3,
                child: TextField(
                  controller: widget.lines[i].unitPrice,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  onChanged: _changed,
                  decoration: InputDecoration(labelText: 'Unit price ($cur)', hintText: '0.00'),
                ),
              ),
            ]),
            gap8,
          ]),
        ),
      if (widget.error != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(widget.error!, style: TextStyle(color: context.c.bad, fontSize: 12.5))),
      Align(
        alignment: Alignment.centerLeft,
        child: OutlinedButton.icon(onPressed: () => setState(() => widget.lines.add(EditLine())), icon: const Icon(Icons.add_rounded, size: 18), label: const Text('Add line')),
      ),
      gap16,
      Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: context.c.surface2, borderRadius: BorderRadius.circular(12), border: Border.all(color: context.c.line)),
        child: Column(children: [
          _row(context, 'Subtotal', f.cents(t.subtotal, cur)),
          gap8,
          Row(children: [
            Expanded(child: TextField(controller: widget.discount, keyboardType: const TextInputType.numberWithOptions(decimal: true), onChanged: _changed, decoration: const InputDecoration(labelText: 'Discount (amount)'))),
            gap8,
            Expanded(child: TextField(controller: widget.taxRate, keyboardType: const TextInputType.numberWithOptions(decimal: true), onChanged: _changed, decoration: const InputDecoration(labelText: 'Tax rate (%)'))),
          ]),
          gap8,
          _row(context, 'Tax', f.cents(t.tax, cur)),
          Divider(height: 20, color: context.c.lineStrong),
          _row(context, 'Total', f.cents(t.total, cur), strong: true),
        ]),
      ),
    ]);
  }

  Widget _row(BuildContext context, String label, String value, {bool strong = false}) => Row(children: [
        Text(label, style: strong ? context.t.titleMedium : context.t.bodyMedium!.copyWith(color: context.c.muted)),
        const Spacer(),
        Text(value, style: (strong ? context.t.titleMedium : context.t.bodyMedium)!.copyWith(fontFeatures: const [FontFeature.tabularFigures()])),
      ]);
}

/// Read-only lines + totals, as on the printed document.
class LinesView extends StatelessWidget {
  const LinesView({super.key, required this.items, required this.totals, required this.currency});
  final List<Json> items;
  final Json totals;
  final String currency;
  @override
  Widget build(BuildContext context) {
    final discount = f.toCents(totals['discount']);
    final tax = f.toCents(totals['taxAmount']);
    final paid = totals['amountPaid'] == null ? 0 : f.toCents(totals['amountPaid']);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      for (var i = 0; i < items.length; i++) ...[
        if (i > 0) Divider(height: 20, color: context.c.line),
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(width: 22, child: Text('${i + 1}.', style: context.t.bodySmall)),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(items[i].s('description').split('\n').first, style: context.t.bodyMedium!.copyWith(fontWeight: FontWeight.w600)),
              if (items[i].s('description').contains('\n'))
                Text(items[i].s('description').split('\n').skip(1).join('\n'), style: context.t.bodySmall!.copyWith(color: context.c.text2)),
              const SizedBox(height: 2),
              Text('${f.qty(items[i]['quantity'])} × ${f.money(items[i]['unitPrice'], currency)}', style: context.t.bodySmall),
            ]),
          ),
          gap8,
          MoneyText(items[i]['lineTotal'], currency),
        ]),
      ],
      Divider(height: 24, color: context.c.lineStrong),
      _total(context, 'Subtotal', f.money(totals['subtotal'], currency)),
      if (discount > 0) _total(context, 'Discount', '− ${f.money(totals['discount'], currency)}'),
      if (tax > 0 || (num.tryParse(totals.s('taxRate')) ?? 0) > 0) _total(context, 'Tax (${num.tryParse(totals.s('taxRate')) ?? 0}%)', f.money(totals['taxAmount'], currency)),
      gap8,
      Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(color: context.c.text, borderRadius: BorderRadius.circular(10)),
        child: Row(children: [
          Text('TOTAL $currency', style: TextStyle(fontFamily: 'Geist', fontSize: 12, letterSpacing: 1.2, fontWeight: FontWeight.w600, color: context.c.bg)),
          const Spacer(),
          Text(f.money(totals['total'], currency), style: TextStyle(fontFamily: 'Geist', fontSize: 16, fontWeight: FontWeight.w700, color: context.c.bg, fontFeatures: const [FontFeature.tabularFigures()])),
        ]),
      ),
      if (paid > 0) ...[
        gap8,
        _total(context, 'Received', '− ${f.money(totals['amountPaid'], currency)}'),
        _total(context, 'Balance due', f.cents(f.toCents(totals['total']) - paid, currency), strong: true),
      ],
    ]);
  }

  Widget _total(BuildContext context, String label, String value, {bool strong = false}) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(children: [
          Text(label, style: strong ? context.t.titleSmall : context.t.bodyMedium!.copyWith(color: context.c.muted)),
          const Spacer(),
          Text(value, style: (strong ? context.t.titleSmall : context.t.bodyMedium)!.copyWith(fontFeatures: const [FontFeature.tabularFigures()])),
        ]),
      );
}
