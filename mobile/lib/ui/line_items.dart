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
  EditLine({
    this.id,
    this.sourceId,
    String description = '',
    String model = '',
    String hsCode = '',
    String quantity = '1',
    String unit = 'pcs',
    String unitPrice = '',
    String unitCost = '',
    this.costSourceId,
    this.fxRate,
    this.costNote,
  })  : description = TextEditingController(text: description),
        model = TextEditingController(text: model),
        hsCode = TextEditingController(text: hsCode),
        quantity = TextEditingController(text: quantity),
        unit = TextEditingController(text: unit),
        unitPrice = TextEditingController(text: unitPrice),
        unitCost = TextEditingController(text: unitCost),
        margin = TextEditingController(),
        showCodes = model.isNotEmpty || hsCode.isNotEmpty,
        showCost = unitCost.isNotEmpty;
  final String? id;
  final String? sourceId;
  final TextEditingController description, model, hsCode, quantity, unit, unitPrice;
  /// Internal (never printed): what one unit costs us incl. VAT, the factory line it came from, and the rate used.
  final TextEditingController unitCost, margin;
  String? costSourceId;
  String? fxRate;
  String? costNote;
  bool showCodes;
  bool showCost;

  /// Margin on the selling price (without our VAT), one decimal, half away from zero (same as the server).
  static String _marginText(String priceText, String cost, f.Vat vat) {
    final price = num.tryParse(priceText);
    final p = price == null ? null : vat.net(price), c = num.tryParse(cost);
    if (p == null || c == null || p <= 0 || c <= 0) return '';
    final m = (p - c) / p * 100;
    final r = (m.abs() * 10).round() / 10 * m.sign;
    return r == r.roundToDouble() ? r.toStringAsFixed(0) : r.toStringAsFixed(1);
  }

  /// The price that gives [marginPercent] on [cost]: cost / (1 − m%) (plus our VAT when prices include it), to the cent.
  static String priceFor(num cost, num marginPercent, [f.Vat vat = const f.Vat()]) => ((vat.gross(cost / (1 - marginPercent / 100)) * 100).round() / 100).toStringAsFixed(2);

  void refreshMargin([f.Vat vat = const f.Vat()]) => margin.text = _marginText(unitPrice.text, unitCost.text, vat);

  factory EditLine.fromJson(Json j) => EditLine(
        id: j.s('id').isEmpty ? null : j.s('id'),
        sourceId: j.s('sourceId').isEmpty ? null : j.s('sourceId'),
        description: j.s('description'),
        model: j.s('model'),
        hsCode: j.s('hsCode'),
        quantity: f.qty(j['quantity'] ?? '1').replaceAll(',', ''),
        unit: j.s('unit').isEmpty ? 'pcs' : j.s('unit'),
        unitPrice: j.s('unitPrice').isEmpty ? '' : (num.tryParse(j.s('unitPrice'))?.toString() ?? j.s('unitPrice')),
        unitCost: j.s('unitCost').isEmpty ? '' : (num.tryParse(j.s('unitCost'))?.toString() ?? j.s('unitCost')),
        costSourceId: j.sn('costSourceId') ?? j.sn('supplierQuoteItemId'),
        fxRate: j.sn('fxRate'),
        costNote: j.sn('costNote'),
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
        if (priced && unitCost.text.trim().isNotEmpty) ...{
          'unitCost': unitCost.text.trim(),
          'costSourceId': ?costSourceId,
          'fxRate': ?fxRate,
        },
      };
  bool get isEmpty => description.text.trim().isEmpty && unitPrice.text.trim().isEmpty;
  void dispose() {
    for (final c in [description, model, hsCode, quantity, unit, unitPrice, unitCost, margin]) {
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
    this.vat = const f.Vat(),
    this.currency = 'USD',
    this.error,
    this.priced = true,
    this.sourceLabel,
    this.costing = false,
    this.hint = 'e.g. Rotary tablet press, 35 stations, GMP, SS316',
  });
  final List<EditLine> lines;
  final TextEditingController? discount;
  /// The VAT from Settings; never typed on a document.
  final f.Vat vat;
  final String currency;
  final String? error;
  final bool priced;
  /// Shown on lines that came from the step before, e.g. "Requested by the customer".
  final String? sourceLabel;
  /// Show our cost and margin per line (internal; never printed).
  final bool costing;
  final String hint;
  @override
  State<LineItemsEditor> createState() => _LineItemsEditorState();
}

class _LineItemsEditorState extends State<LineItemsEditor> {
  void _changed(_) => setState(() {});

  @override
  void initState() {
    super.initState();
    for (final l in widget.lines) {
      l.refreshMargin(widget.vat);
    }
  }

  @override
  Widget build(BuildContext context) {
    final cur = widget.currency;
    final priced = widget.priced;
    final vat = widget.vat;
    final t = f.lineTotals([for (final l in widget.lines) (quantity: l.quantity.text, unitPrice: priced ? l.unitPrice.text : '0')], widget.discount?.text ?? '0', '${vat.rate}', included: vat.included);
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
            TextField(controller: widget.discount, keyboardType: const TextInputType.numberWithOptions(decimal: true), onChanged: _changed, decoration: const InputDecoration(labelText: 'Discount (amount)')),
            gap8,
            if (!vat.included && (vat.rate > 0 || vat.exempt)) _row(context, vat.exempt ? 'VAT (customer exempt)' : 'VAT ${vat.rate}%', f.cents(t.tax, cur)),
            Divider(height: 20, color: context.c.lineStrong),
            _row(context, vat.included && vat.rate > 0 ? 'Total incl. VAT' : 'Total', f.cents(t.total, cur), strong: true),
            if (vat.included) _row(context, vat.exempt ? 'No VAT (customer exempt)' : 'of which VAT ${vat.rate}%', f.cents(t.tax, cur)),
            gap4,
            Align(alignment: Alignment.centerLeft, child: Text('VAT is set by the super admin in Settings${vat.exempt ? '; this customer is VAT exempt' : ''}.', style: context.t.bodySmall)),
            if (widget.costing) _costSummary(context, t.discount),
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
                onChanged: (_) => setState(() => l.refreshMargin(widget.vat)),
                decoration: InputDecoration(labelText: 'Unit price (${widget.currency})', hintText: '0.00'),
              ),
            ),
          ],
        ]),
        if (priced && widget.costing) _costRow(context, l),
        gap8,
      ]),
    );
  }

  Widget _costRow(BuildContext context, EditLine l) {
    if (!l.showCost) {
      return Align(
        alignment: Alignment.centerRight,
        child: TextButton(
          style: TextButton.styleFrom(visualDensity: VisualDensity.compact),
          onPressed: () => setState(() => l.showCost = true),
          child: const Text('+ Our cost', style: TextStyle(fontSize: 12.5)),
        ),
      );
    }
    return Container(
      margin: const EdgeInsets.only(top: 8, right: 6),
      padding: const EdgeInsets.fromLTRB(10, 8, 10, 4),
      decoration: BoxDecoration(color: context.c.surface2, borderRadius: BorderRadius.circular(10)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (l.costNote != null) Padding(padding: const EdgeInsets.only(bottom: 6), child: Text(l.costNote!, style: context.t.bodySmall)),
        Row(children: [
          Expanded(
            flex: 3,
            child: TextField(
              controller: l.unitCost,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              onChanged: (_) => setState(() => l.refreshMargin(widget.vat)),
              decoration: InputDecoration(labelText: 'Our cost (${widget.currency})', isDense: true),
            ),
          ),
          gap8,
          Expanded(
            flex: 2,
            child: TextField(
              controller: l.margin,
              keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true),
              onChanged: (v) {
                final m = num.tryParse(v), c = num.tryParse(l.unitCost.text);
                if (m != null && m < 95 && c != null && c > 0) setState(() => l.unitPrice.text = EditLine.priceFor(c, m, widget.vat));
              },
              decoration: const InputDecoration(labelText: 'Margin', suffixText: '%', isDense: true),
            ),
          ),
        ]),
        gap4,
        Text('Internal, not printed', style: context.t.bodySmall!.copyWith(fontSize: 11)),
      ]),
    );
  }

  /// Cost, profit and margin over the lines that have a cost (freight and other uncosted lines left out).
  Widget _costSummary(BuildContext context, int discountCents) {
    var cost = 0, sales = 0, uncosted = 0;
    for (final l in widget.lines) {
      if (l.description.text.trim().isEmpty) continue;
      final q = num.tryParse(l.quantity.text) ?? 0;
      final c = num.tryParse(l.unitCost.text);
      if (c == null || l.unitCost.text.trim().isEmpty) {
        uncosted++;
        continue;
      }
      cost += (f.toCents(c) * q).round();
      sales += (f.toCents(widget.vat.net(num.tryParse(l.unitPrice.text) ?? 0)) * q).round();
    }
    if (cost == 0) return const SizedBox.shrink();
    final profit = sales - cost;
    final pct = sales > 0 ? ((profit / sales * 1000).round() / 10) : 0;
    final bad = profit - discountCents < 0;
    return Container(
      margin: const EdgeInsets.only(top: 12),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(borderRadius: BorderRadius.circular(10), border: Border.all(color: context.c.lineStrong)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text('Internal, not printed', style: context.t.labelMedium),
        gap4,
        _row(context, 'Our cost (incl. VAT)', f.cents(cost, widget.currency)),
        Row(children: [
          Expanded(child: Text('Profit before discount', style: context.t.bodyMedium!.copyWith(color: context.c.muted))),
          gap8,
          Text('${f.cents(profit, widget.currency)} · $pct%', style: context.t.bodyMedium!.copyWith(fontWeight: FontWeight.w600, color: profit < 0 ? context.c.bad : context.c.ok)),
        ]),
        if (discountCents > 0)
          Text('After the discount: ${f.cents(profit - discountCents, widget.currency)} profit', style: context.t.bodySmall!.copyWith(color: bad ? context.c.bad : null)),
        if (uncosted > 0) Text('$uncosted line(s) without a cost (e.g. freight) are left out.', style: context.t.bodySmall),
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
    final included = totals['pricesIncludeVat'] == true;
    final rate = num.tryParse(totals.s('taxRate')) ?? 0;
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
      if (!included && (tax > 0 || rate > 0)) _total(context, 'VAT ($rate%)', f.money(totals['taxAmount'], currency)),
      gap8,
      Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(color: context.c.text, borderRadius: BorderRadius.circular(10)),
        child: Row(children: [
          Text('TOTAL $currency${included && rate > 0 ? ' INCL. VAT' : ''}', style: TextStyle(fontFamily: 'Geist', fontSize: 12, letterSpacing: 1.2, fontWeight: FontWeight.w600, color: context.c.bg)),
          const Spacer(),
          Text(f.money(totals['total'], currency), style: TextStyle(fontFamily: 'Geist', fontSize: 16, fontWeight: FontWeight.w700, color: context.c.bg, fontFeatures: const [FontFeature.tabularFigures()])),
        ]),
      ),
      if (included && (tax > 0 || rate > 0)) Padding(padding: const EdgeInsets.only(top: 4), child: _total(context, 'of which VAT ($rate%)', f.money(totals['taxAmount'], currency))),
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
