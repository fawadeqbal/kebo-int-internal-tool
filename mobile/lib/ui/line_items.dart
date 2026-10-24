import 'package:flutter/material.dart';

import '../core/format.dart' as f;
import '../core/json.dart';
import 'kit.dart';

/// Units offered on every line (any short text works too). Same list as the web.
const kUnits = ['pcs', 'set', 'unit', 'lot', 'kg', 'ton', 'm', 'm²', 'm³', 'L', 'carton', 'roll', 'pair'];

/// One editable line, the same on every document: the item (first line = its
/// name, then details), brand/model, HS code, quantity, unit and (when priced)
/// unit price. [sourceId] is the line it came from on the step before.
class EditLine {
  EditLine({this.id, this.sourceId, String description = '', String model = '', String hsCode = '', String quantity = '1', String unit = 'pcs', String unitPrice = ''})
      : description = TextEditingController(text: description),
        model = TextEditingController(text: model),
        hsCode = TextEditingController(text: hsCode),
        quantity = TextEditingController(text: quantity),
        unit = TextEditingController(text: unit),
        unitPrice = TextEditingController(text: unitPrice),
        showCodes = model.isNotEmpty || hsCode.isNotEmpty;
  final String? id;
  final String? sourceId;
  final TextEditingController description, model, hsCode, quantity, unit, unitPrice;
  bool showCodes;

  factory EditLine.fromJson(Json j) => EditLine(
        id: j.s('id').isEmpty ? null : j.s('id'),
        sourceId: j.s('sourceId').isEmpty ? null : j.s('sourceId'),
        description: j.s('description'),
        model: j.s('model'),
        hsCode: j.s('hsCode'),
        quantity: f.qty(j['quantity'] ?? '1').replaceAll(',', ''),
        unit: j.s('unit').isEmpty ? 'pcs' : j.s('unit'),
        unitPrice: j.s('unitPrice').isEmpty ? '' : (num.tryParse(j.s('unitPrice'))?.toString() ?? j.s('unitPrice')),
      );

  /// A stored requested item → an editable one (keeps its id so quotations stay linked).
  factory EditLine.fromItem(Json j) => EditLine.fromJson({...j, 'unitPrice': ''});

  Map<String, String> toJson({bool priced = true}) => {
        'id': ?id,
        'sourceId': ?sourceId,
        'description': description.text.trim(),
        'model': model.text.trim(),
        if (priced) 'hsCode': hsCode.text.trim(),
        'quantity': quantity.text.trim(),
        'unit': unit.text.trim(),
        if (priced) 'unitPrice': unitPrice.text.trim(),
      };
  bool get isEmpty => description.text.trim().isEmpty && unitPrice.text.trim().isEmpty;
  void dispose() {
    for (final c in [description, model, hsCode, quantity, unit, unitPrice]) {
      c.dispose();
    }
  }
}

/// The one line editor: requested items (priced: false) or quotation / invoice
/// lines with discount, tax and live totals (calculated exactly like the server).
class LineItemsEditor extends StatefulWidget {
  const LineItemsEditor({
    super.key,
    required this.lines,
    this.discount,
    this.taxRate,
    this.currency = 'USD',
    this.error,
    this.priced = true,
    this.sourceLabel,
    this.hint = 'e.g. Rotary tablet press, 35 stations, GMP, SS316',
  });
  final List<EditLine> lines;
  final TextEditingController? discount;
  final TextEditingController? taxRate;
  final String currency;
  final String? error;
  final bool priced;
  /// Shown on lines that came from the step before, e.g. "Requested by the customer".
  final String? sourceLabel;
  final String hint;
  @override
  State<LineItemsEditor> createState() => _LineItemsEditorState();
}

class _LineItemsEditorState extends State<LineItemsEditor> {
  void _changed(_) => setState(() {});

  @override
  Widget build(BuildContext context) {
    final cur = widget.currency;
    final priced = widget.priced;
    final t = f.lineTotals([for (final l in widget.lines) (quantity: l.quantity.text, unitPrice: priced ? l.unitPrice.text : '0')], widget.discount?.text ?? '0', widget.taxRate?.text ?? '0');
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      for (var i = 0; i < widget.lines.length; i++) _line(context, i, t.lines[i]),
      if (widget.error != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(widget.error!, style: TextStyle(color: context.c.bad, fontSize: 12.5))),
      Align(
        alignment: Alignment.centerLeft,
        child: OutlinedButton.icon(
          onPressed: () => setState(() => widget.lines.add(EditLine())),
          icon: const Icon(Icons.add_rounded, size: 18),
          label: Text(priced ? 'Add line' : 'Add another item'),
        ),
      ),
      if (priced) ...[
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
      ],
    ]);
  }

  Widget _line(BuildContext context, int i, int lineTotal) {
    final l = widget.lines[i];
    final priced = widget.priced;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.fromLTRB(12, 10, 6, 6),
      decoration: BoxDecoration(color: context.c.surface, borderRadius: BorderRadius.circular(12), border: Border.all(color: context.c.line)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Text(priced ? 'Line ${i + 1}' : 'Item ${i + 1}', style: context.t.labelMedium),
          if (widget.sourceLabel != null && l.sourceId != null) ...[gap8, Flexible(child: Text(widget.sourceLabel!, overflow: TextOverflow.ellipsis, style: context.t.bodySmall))],
          const Spacer(),
          if (priced) Text(f.cents(lineTotal, widget.currency), style: context.t.bodyMedium!.copyWith(fontWeight: FontWeight.w600, fontFeatures: const [FontFeature.tabularFigures()])),
          IconButton(
            visualDensity: VisualDensity.compact,
            tooltip: priced ? 'Remove line' : 'Remove item',
            onPressed: widget.lines.length == 1 ? null : () => setState(() => widget.lines.removeAt(i).dispose()),
            icon: const Icon(Icons.delete_outline_rounded, size: 20),
          ),
        ]),
        TextField(controller: l.description, minLines: 1, maxLines: 6, onChanged: _changed, decoration: InputDecoration(hintText: widget.hint)),
        if (l.showCodes) ...[
          gap8,
          Row(children: [
            Expanded(child: TextField(controller: l.model, decoration: const InputDecoration(labelText: 'Brand / model'))),
            if (priced) ...[gap8, Expanded(child: TextField(controller: l.hsCode, decoration: const InputDecoration(labelText: 'HS code')))],
          ]),
        ] else
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              style: TextButton.styleFrom(visualDensity: VisualDensity.compact, padding: EdgeInsets.zero),
              onPressed: () => setState(() => l.showCodes = true),
              child: Text(priced ? '+ Model / HS code' : '+ Brand / model', style: const TextStyle(fontSize: 12.5)),
            ),
          ),
        gap8,
        Row(children: [
          Expanded(
            flex: 2,
            child: TextField(controller: l.quantity, keyboardType: const TextInputType.numberWithOptions(decimal: true), onChanged: _changed, decoration: const InputDecoration(labelText: 'Qty')),
          ),
          gap8,
          Expanded(flex: 2, child: UnitField(controller: l.unit)),
          if (priced) ...[
            gap8,
            Expanded(
              flex: 3,
              child: TextField(
                controller: l.unitPrice,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                onChanged: _changed,
                decoration: InputDecoration(labelText: 'Unit price (${widget.currency})', hintText: '0.00'),
              ),
            ),
          ],
        ]),
        gap8,
      ]),
    );
  }

  Widget _row(BuildContext context, String label, String value, {bool strong = false}) => Row(children: [
        Text(label, style: strong ? context.t.titleMedium : context.t.bodyMedium!.copyWith(color: context.c.muted)),
        const Spacer(),
        Text(value, style: (strong ? context.t.titleMedium : context.t.bodyMedium)!.copyWith(fontFeatures: const [FontFeature.tabularFigures()])),
      ]);
}

/// A unit box with the common units one tap away.
class UnitField extends StatelessWidget {
  const UnitField({super.key, required this.controller});
  final TextEditingController controller;
  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      decoration: InputDecoration(
        labelText: 'Unit',
        suffixIcon: PopupMenuButton<String>(
          tooltip: 'Choose a unit',
          icon: const Icon(Icons.arrow_drop_down_rounded),
          onSelected: (u) => controller.text = u,
          itemBuilder: (_) => [for (final u in kUnits) PopupMenuItem(value: u, child: Text(u))],
        ),
      ),
    );
  }
}

/// "Model X · HS 8479.89" for a stored line.
String lineCodes(Json it) => [if (it.s('model').isNotEmpty) 'Model ${it.s('model')}', if (it.s('hsCode').isNotEmpty) 'HS ${it.s('hsCode')}'].join(' · ');

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
              if (lineCodes(items[i]).isNotEmpty) Text(lineCodes(items[i]), style: context.t.bodySmall),
              if (items[i].s('description').contains('\n'))
                Text(items[i].s('description').split('\n').skip(1).join('\n'), style: context.t.bodySmall!.copyWith(color: context.c.text2)),
              const SizedBox(height: 2),
              Text('${f.qty(items[i]['quantity'])} ${items[i].s('unit')} × ${f.money(items[i]['unitPrice'], currency)}', style: context.t.bodySmall),
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
