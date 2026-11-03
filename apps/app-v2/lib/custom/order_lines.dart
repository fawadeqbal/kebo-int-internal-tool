import 'package:flutter/material.dart' hide Badge;

import '../core/json.dart';
import '../core/scope.dart';
import '../ds/ds.dart';
import '../generated/models.g.dart';

/// "40" → 40; "" → null.
num? _n(Object? v) => v == null || '$v'.trim().isEmpty ? null : num.tryParse('$v'.replaceAll(',', ''));
String _fmt(num? n) => n == null ? '' : (n == n.roundToDouble() ? '${n.round()}' : n.toStringAsFixed(2));

/// The goods lines of an order (charges are not counted or packed), as line rows.
List<LineRow> goodsRows(List<Json> lines, Json Function(Json l) values) => [
      for (final l in lines.where((l) => l.str('type', 'goods') == 'goods'))
        LineRow(
          key: l.str('id'),
          no: l.str('no'),
          title: l.str('description'),
          sub: joinParts([joinWords([_fmt(_n(l['quantity'])), l.strOrNull('unit')]), l.strOrNull('model')]),
          values: values(l),
        ),
    ];

/// Goods received: how many of each line came in from the factory, typed down the list.
Future<bool> openGoodsReceived(BuildContext context, String orderId, String? refNo, List<Json> lines) {
  final api = context.api;
  final ordered = {for (final l in lines) l.str('id'): _n(l['quantity']) ?? 0};
  num got(Json v) => _n(v['receivedQty']) ?? 0;
  bool done(LineRow r, Json v) => got(v) >= (ordered[r.key] ?? 0) && (ordered[r.key] ?? 0) > 0;
  bool short(LineRow r, Json v) => got(v) > 0 && got(v) < (ordered[r.key] ?? 0);
  return openLines(
    context,
    rows: goodsRows(lines, (l) => {'receivedQty': _fmt(_n(l['receivedQty']) == 0 ? null : _n(l['receivedQty']))}),
    spec: LineSpec(
      title: 'Goods received',
      subtitle: joinParts([refNo, 'type how many came in']),
      inline: const FieldDef('receivedQty', 'Received', FieldKind.decimal, hint: '0'),
      filters: [
        LineFilter('All', (r, v) => true),
        LineFilter('Not yet', (r, v) => got(v) == 0),
        LineFilter('Short', short),
        LineFilter('Done', done),
      ],
      bulk: [LineBulk('All in full', (r, v) => {'receivedQty': _fmt(ordered[r.key])})],
      rowText: (r, v) => joinParts(['of ${r.sub}', if (short(r, v)) '${_fmt((ordered[r.key] ?? 0) - got(v))} short']),
      rowTone: (r, v) => done(r, v) ? Tone.ok : short(r, v) ? Tone.warn : null,
      summary: (rows, valueOf) {
        final d = rows.where((r) => done(r, valueOf(r))).length;
        final s = rows.where((r) => short(r, valueOf(r))).length;
        final none = rows.where((r) => got(valueOf(r)) == 0).length;
        return LineSummary('$d of ${rows.length} received', joinParts([if (s > 0) '$s short', if (none > 0) '$none not counted yet']));
      },
      saveLabel: 'Save',
      save: (changes) => inBatches(
        [for (final e in changes.entries) {'lineId': e.key, 'receivedQty': _n(e.value['receivedQty']) ?? 0}],
        (batch) => api.put('/api/orders/$orderId/receipt', {'on': DateTime.now().toIso8601String().substring(0, 10), 'lines': batch}),
      ),
    ),
  );
}

const _types = {'Carton': 'Carton', 'Pallet': 'Pallet', 'Wooden case': 'Wooden case', 'Crate': 'Crate', 'Bag': 'Bag', 'Drum': 'Drum'};

/// The packing list: packages, type, weights and volume for each line, one line at a time, with Fill down.
Future<bool> openPacking(BuildContext context, String orderId, String? refNo, List<Json> lines) {
  final api = context.api;
  bool packed(Json v) => (_n(v['packages']) ?? 0) > 0;
  num total(List<LineRow> rows, Json Function(LineRow) valueOf, String k) => rows.fold<num>(0, (s, r) => s + (_n(valueOf(r)[k]) ?? 0));
  return openLines(
    context,
    rows: goodsRows(lines, (l) {
      final p = l.obj('packing', (m) => m) ?? const {};
      return {
        'packages': _fmt(_n(p['packages'])),
        'packageType': p.strOrNull('packageType') ?? 'Carton',
        'netWeightKg': _fmt(_n(p['netWeightKg'])),
        'grossWeightKg': _fmt(_n(p['grossWeightKg'])),
        'cbm': _fmt(_n(p['cbm'])),
      };
    }),
    spec: LineSpec(
      title: 'Packing list',
      subtitle: joinParts([refNo, 'tap a line to fill it']),
      fields: const [
        FieldDef('packages', 'Packages', FieldKind.integer, required: true),
        FieldDef('packageType', 'Type', FieldKind.choice, options: _types, defaultValue: 'Carton'),
        FieldDef('netWeightKg', 'Net kg', FieldKind.decimal),
        FieldDef('grossWeightKg', 'Gross kg', FieldKind.decimal),
        FieldDef('cbm', 'CBM', FieldKind.decimal),
      ],
      fillDown: true,
      filters: [LineFilter('All', (r, v) => true), LineFilter('Not packed', (r, v) => !packed(v)), LineFilter('Packed', (r, v) => packed(v))],
      rowText: (r, v) => packed(v)
          ? joinParts([
              '${v['packages']} ${(v['packageType'] as String? ?? 'carton').toLowerCase()}${v['packages'] == '1' ? '' : 's'}',
              if (_n(v['grossWeightKg']) != null) '${v['grossWeightKg']} kg',
              if (_n(v['cbm']) != null) '${v['cbm']} CBM',
            ])
          : '${r.sub} · not packed yet',
      rowTone: (r, v) => packed(v) ? null : Tone.warn,
      summary: (rows, valueOf) {
        final missing = rows.where((r) => !packed(valueOf(r))).length;
        return LineSummary(
          joinParts(['${_fmt(total(rows, valueOf, 'packages'))} packages', '${_fmt(total(rows, valueOf, 'grossWeightKg'))} kg', '${_fmt(total(rows, valueOf, 'cbm'))} CBM']),
          missing == 0 ? 'every line packed' : '$missing lines not packed',
        );
      },
      saveLabel: 'Save',
      save: (changes) {
        final rows = goodsRows(lines, (l) => const {});
        final base = {for (final r in rows) r.key: r};
        return inBatches(
          [
            for (final e in changes.entries)
              if (base.containsKey(e.key))
                {
                  'lineId': e.key,
                  'packages': _n(e.value['packages']),
                  'packageType': e.value['packageType'] ?? 'Carton',
                  'netWeightKg': _n(e.value['netWeightKg']),
                  'grossWeightKg': _n(e.value['grossWeightKg']),
                  'cbm': _n(e.value['cbm']),
                },
          ],
          (batch) => api.put('/api/orders/$orderId/packing', {'lines': batch}),
        );
      },
    ),
  );
}

/// The order's goods on its page: the first lines, See all, and the two line tasks.
class OrderLines extends StatelessWidget {
  const OrderLines(this.order, {super.key, required this.title});
  final Order order;
  final String title;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final lines = (order.lines as List<dynamic>? ?? const []).whereType<Map<String, dynamic>>().toList();
    final goods = lines.where((l) => l.str('type', 'goods') == 'goods').toList();
    if (lines.isEmpty) return const SizedBox.shrink();
    final received = goods.where((l) => (_n(l['receivedQty']) ?? 0) >= (_n(l['quantity']) ?? 0) && (_n(l['quantity']) ?? 0) > 0).length;
    final packed = goods.where((l) => (_n(l.obj('packing', (m) => m)?['packages']) ?? 0) > 0).length;
    Future<void> after(bool saved) async {
      if (saved && context.mounted) {
        toast(context, 'Saved');
        await RecordScope.reloadOf(context);
      }
    }

    final all = [
      for (final l in lines)
        LineRow(
          key: l.str('id'),
          no: l.str('no'),
          title: l.str('description'),
          sub: joinParts([joinWords([_fmt(_n(l['quantity'])), l.strOrNull('unit')]), if (_n(l['receivedQty']) != null && l.str('type', 'goods') == 'goods') 'received ${_fmt(_n(l['receivedQty']))}']),
          values: l,
        ),
    ];
    return SectionCard(
      title: '$title · ${lines.length} lines',
      child: Column(children: [
        for (final (i, r) in all.take(4).indexed)
          PhoneRow(
            RowData(title: '${r.no}  ${r.title}', sub: [r.sub], value: fmtMoney(r.values.strOrNull('lineTotal'), order.currency)),
            divider: i < 3 && i < all.length - 1,
          ),
        if (all.length > 4)
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              onPressed: () => openLines(
                context,
                rows: all,
                spec: LineSpec(
                  title: 'Goods · ${lines.length} lines',
                  subtitle: order.refNo,
                  rowText: (r, v) => joinParts([r.sub, fmtMoney(v.strOrNull('lineTotal'), order.currency)]),
                  summary: (rows, valueOf) => LineSummary('${rows.length} lines', fmtMoney(order.total, order.currency)),
                ),
              ),
              child: Text('See all ${lines.length} lines ›'),
            ),
          ),
        Divider(height: 1, color: c.line),
        if (goods.isNotEmpty) ...[
          PhoneRow(RowData(
            title: 'Goods received',
            sub: ['$received of ${goods.length} lines'],
            tone: received == goods.length ? Tone.ok : Tone.warn,
            onTap: () async => after(await openGoodsReceived(context, order.id, order.refNo, lines)),
          )),
          PhoneRow(
            RowData(
              title: 'Packing list',
              sub: ['$packed of ${goods.length} lines packed'],
              tone: packed == goods.length ? Tone.ok : Tone.info,
              onTap: () async => after(await openPacking(context, order.id, order.refNo, lines)),
            ),
            divider: false,
          ),
        ],
      ]),
    );
  }
}
