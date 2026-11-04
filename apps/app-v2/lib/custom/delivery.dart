import 'package:flutter/material.dart' hide Badge;

import '../core/api.dart';
import '../core/json.dart';
import '../core/outbox.dart';
import '../core/scope.dart';
import '../ds/ds.dart';
import '../generated/enums.g.dart';
import '../generated/models.g.dart';
import 'order_lines.dart';
import 'waiting.dart';

const permDelivery = 'delivery.manage';

String _today() => isoDay(DateTime.now())!;
num? _n(Object? v) => v == null || '$v'.trim().isEmpty ? null : num.tryParse('$v'.replaceAll(',', ''));
String _fmt(num? n) => n == null ? '' : (n == n.roundToDouble() ? '${n.round()}' : n.toStringAsFixed(2));

/// Opens Delivery & SAT for [order] (also from the ⋯ menu). True when something was saved.
Future<bool> openDelivery(BuildContext context, Order order) async =>
    await Navigator.of(context, rootNavigator: true).push<bool>(MaterialPageRoute(builder: (_) => DeliveryScreen(order: order))) ?? false;

/// At the customer's site: what arrived and in what condition, problems with photos and claims,
/// who received it, and the SAT. Read only for people without delivery.manage.
class DeliveryScreen extends StatefulWidget {
  const DeliveryScreen({super.key, required this.order});
  final Order order;

  @override
  State<DeliveryScreen> createState() => _DeliveryScreenState();
}

class _DeliveryScreenState extends State<DeliveryScreen> {
  Json? d; // flow.delivery
  List<Json> lines = const [];
  String? arrived, error;
  bool loaded = false, saved = false;

  Order get o => widget.order;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!loaded && error == null) _load();
  }

  Future<void> _load() async {
    final api = context.api;
    try {
      final r = await Future.wait([api.get('/api/orders/${o.id}'), api.get('/api/orders/${o.id}/flow')]);
      final ships = r[1].listAt('shipping.shipments');
      final arrivedOn = ships.map((s) => s.strOrNull('arrivedOn')).whereType<String>().fold<String?>(null, (a, b) => a == null || b.compareTo(a) > 0 ? b : a);
      if (mounted) {
        setState(() {
          d = r[1].objAt('delivery');
          lines = r[0].list('lines', (m) => m).where((l) => l.str('type', 'goods') == 'goods').toList();
          arrived = arrivedOn;
          loaded = true;
          error = null;
        });
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => error = e.message);
    }
  }

  Future<void> _after(Future<Object?> f) async {
    final r = await f;
    if ((r == true || r is Map) && mounted) {
      saved = true;
      await _load();
    }
  }

  bool get canEdit => context.can(permDelivery);

  // ------------------------------------------------------------ actions

  Future<bool> _allGood() => FormSheet.open(
        context,
        title: 'Everything arrived in good condition',
        save: 'Confirm delivery',
    keeps: true,
        intro: 'Every line is marked delivered in full and in good condition.',
        initial: {'deliveredOn': _today()},
        groups: const [FormGroup(fields: [FieldDef('deliveredOn', 'Delivered on', FieldKind.date, required: true)])],
        send: (api, body) => sendOrKeep(context, 'Delivered in full · ${o.refNo}', 'POST', '/api/orders/${o.id}/delivery/all-good', body),
      );

  Future<bool> _details() => FormSheet.open(
        context,
        title: 'Delivered',
        save: 'Save',
    keeps: true,
        initial: {'deliveredOn': d?.strOrNull('deliveredOn') ?? _today(), 'deliveryReceivedBy': d?.strOrNull('receivedBy') ?? '', 'deliveryNote': d?.strOrNull('note') ?? ''},
        groups: const [
          FormGroup(fields: [
            FieldDef('deliveredOn', 'Delivered on', FieldKind.date, required: true),
            FieldDef('deliveryReceivedBy', 'Received by', FieldKind.text, max: 120, hint: 'e.g. Asad, store keeper'),
            FieldDef('deliveryNote', 'Note', FieldKind.multiline, max: 2000),
          ]),
        ],
        send: (api, body) => sendOrKeep(context, 'Delivery details · ${o.refNo}', 'PATCH', '/api/orders/${o.id}/delivery', body),
      );

  Future<bool> _satDetails() => FormSheet.open(
        context,
        title: 'SAT',
        save: 'Save',
    keeps: true,
        initial: {
          'satPlannedOn': d?.strOrNull('satPlannedOn'),
          'satEngineerId': d?.at('satEngineer.id'),
          'satDoneOn': d?.strOrNull('satDoneOn'),
          'satSignedBy': d?.strOrNull('satSignedBy') ?? '',
        },
        groups: const [
          FormGroup(fields: [
            FieldDef('satPlannedOn', 'Planned on', FieldKind.date),
            FieldDef('satEngineerId', 'Our engineer', FieldKind.pick, source: '/api/users/people'),
            FieldDef('satDoneOn', 'Done on', FieldKind.date),
            FieldDef('satSignedBy', 'Signed by (the customer)', FieldKind.text, max: 120),
          ]),
        ],
        send: (api, body) => sendOrKeep(context, 'SAT details · ${o.refNo}', 'PATCH', '/api/orders/${o.id}/delivery', body),
      );

  Future<bool> _satChecks() {
    final now = d!.list('sat', (m) => m);
    final seed = now.isNotEmpty
        ? [for (final c in now) {'id': c.str('id'), 'item': c.str('item'), 'result': c.str('result', 'pending'), 'note': c.str('note')}]
        : [for (final t in (d!['suggestedSat'] as List<dynamic>? ?? const [])) {'item': '$t', 'result': 'pending', 'note': ''}];
    return FormSheet.open(
      context,
      title: 'SAT checks',
      save: 'Save the checks',
    keeps: true,
      intro: 'What is checked at the customer\'s site, and how it went.',
      initial: {'checks': seed},
      groups: [
        FormGroup(
          list: ListDef('checks',
              itemLabel: 'Check',
              addLabel: 'Add a check',
              fields: [
                const FieldDef('item', 'What is checked', FieldKind.text, required: true, max: 200),
                FieldDef('result', 'Result', FieldKind.choice, options: SatResultEnum.labels, defaultValue: 'pending'),
                const FieldDef('note', 'Note', FieldKind.text, max: 500),
              ],
              blank: () => {'item': '', 'result': 'pending', 'note': ''}),
        ),
      ],
      send: (api, body) => sendOrKeep(context, 'SAT checks · ${o.refNo}', 'PUT', '/api/orders/${o.id}/sat', {
        'checks': [
          for (final c in (body['checks'] as List<dynamic>).cast<Json>())
            {if ('${c['id'] ?? ''}'.isNotEmpty) 'id': c['id'], 'item': '${c['item']}'.trim(), 'result': c['result'] ?? 'pending', if ('${c['note'] ?? ''}'.trim().isNotEmpty) 'note': '${c['note']}'.trim()},
        ],
      }),
    );
  }

  Future<bool> _allPassed() => FormSheet.open(
        context,
        title: 'SAT passed',
        save: 'Every check passed',
    keeps: true,
        intro: 'Every open check is marked passed and the SAT is signed off.',
        initial: {'satDoneOn': _today(), 'satSignedBy': d?.strOrNull('satSignedBy') ?? ''},
        groups: const [
          FormGroup(fields: [
            FieldDef('satDoneOn', 'Done on', FieldKind.date, required: true),
            FieldDef('satSignedBy', 'Signed by (the customer)', FieldKind.text, max: 120),
          ]),
        ],
        send: (api, body) => sendOrKeep(context, 'SAT passed · ${o.refNo}', 'POST', '/api/orders/${o.id}/sat/all-passed', body),
      );

  Future<bool> _claim({String? title}) => openClaim(context, orderId: o.id, title: title);

  // ------------------------------------------------------------ lines

  List<LineRow> get _rows => goodsRows(lines, (l) {
        final dl = l.obj('delivered', (m) => m) ?? const {};
        return {'deliveredQty': dl.strOrNull('qty'), 'condition': dl.strOrNull('condition'), 'note': dl.strOrNull('note'), 'quantity': l.strOrNull('quantity')};
      });

  Future<void> _allLines() async {
    final ok = await openLines(
      context,
      rows: _rows,
      spec: LineSpec(
        title: 'Lines delivered',
        subtitle: joinParts([o.refNo, 'tap a line to mark a problem']),
        filters: [
          LineFilter('All', (r, v) => true),
          LineFilter('Problems', (r, v) => v['condition'] != null && v['condition'] != 'good'),
          LineFilter('Not checked', (r, v) => v['condition'] == null),
          LineFilter('Good', (r, v) => v['condition'] == 'good'),
        ],
        rowText: (r, v) => joinParts([r.sub, LineConditionEnum.label(v['condition'] as String?) ?? 'not checked', v['note'] as String?]),
        rowTone: (r, v) => LineConditionEnum.tones[v['condition']],
        summary: (rows, valueOf) {
          final bad = rows.where((r) => valueOf(r)['condition'] != null && valueOf(r)['condition'] != 'good').length;
          final none = rows.where((r) => valueOf(r)['condition'] == null).length;
          return LineSummary('${rows.length - bad - none} of ${rows.length} good', joinParts([if (bad > 0) '$bad with a problem', if (none > 0) '$none not checked']));
        },
        open: canEdit ? (context, r, v) => openDeliveredLine(context, orderId: o.id, row: r, value: v) : null,
      ),
    );
    if (ok && mounted) {
      saved = true;
      await _load();
    }
  }

  // ------------------------------------------------------------ build

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) Navigator.pop(context, saved);
      },
      child: Scaffold(
        appBar: AppBar(
          title: Semantics(
            header: true,
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('Delivery & SAT'),
              // "Karachi Bottlers · arrived 18 Oct": short, so it fits beside the back button (the order number is on the screen it came from).
              Text(joinParts([o.customer?.name, if (arrived != null) 'arrived ${fmtWhen(DateTime.parse(arrived!))}']),
                  maxLines: 1, overflow: TextOverflow.ellipsis, style: context.text.bodySmall?.copyWith(color: c.text2)),
            ]),
          ),
        ),
        body: error != null
            ? ErrorView(error!, retry: _load)
            : !loaded
                ? const LoadingView()
                : d == null
                    ? const EmptyState(title: 'Delivery & SAT is switched off', text: 'Your company does not use this step.')
                    : _body(context),
        bottomNavigationBar: loaded && d != null && canEdit ? _primary(context) : null,
      ),
    );
  }

  Widget? _primary(BuildContext context) {
    final delivered = d!.strOrNull('deliveredOn') != null;
    final satDone = d!.strOrNull('satDoneOn') != null;
    if (delivered && satDone) return null;
    return SafeArea(
      child: Container(
        padding: const EdgeInsets.fromLTRB(Gap.lg, Gap.md, Gap.lg, Gap.md),
        decoration: BoxDecoration(color: context.colors.surface, border: Border(top: BorderSide(color: context.colors.line))),
        child: FilledButton(
          onPressed: () => _after(delivered ? _allPassed() : _allGood()),
          child: Text(delivered ? 'Record the SAT' : 'Confirm delivery'),
        ),
      ),
    );
  }

  Widget _body(BuildContext context) {
    final c = context.colors;
    final dd = d!;
    final good = dd.str('condition') == 'good';
    final rows = _rows;
    // Problems first, then lines not checked, then good ones.
    int rank(Json v) => v['condition'] == null ? 1 : (v['condition'] == 'good' ? 2 : 0);
    final first = [...rows]..sort((a, b) => rank(a.values).compareTo(rank(b.values)));
    final sat = dd.list('sat', (m) => m);
    final satResult = sat.isEmpty
        ? null
        : sat.any((x) => x.str('result') == 'fail')
            ? const Badge('Failed', Tone.bad)
            : sat.every((x) => x.str('result') == 'pass' || x.str('result') == 'not_applicable')
                ? const Badge('Passed', Tone.ok)
                : const Badge('Pending', Tone.neutral);
    final claims = dd.list('claims', (m) => m);
    Widget edit(VoidCallback onTap, String label) =>
        TextButton.icon(onPressed: onTap, icon: const Icon(Icons.edit_outlined, size: 16), label: Text('Edit', semanticsLabel: 'Edit $label'));

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.fromLTRB(Gap.lg, Gap.sm, Gap.lg, Gap.xl), children: [
        MergeSemantics(
          child: CheckboxListTile(
            value: good,
            onChanged: good || !canEdit ? null : (_) => _after(_allGood()),
            controlAffinity: ListTileControlAffinity.leading,
            tileColor: c.surface,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Gap.radius), side: BorderSide(color: c.line)),
            title: Text('Every line arrived in full and in good condition', style: context.text.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
            subtitle: dd.strOrNull('deliveredOn') == null ? null : Text('Delivered ${fmtDate(DateTime.parse(dd.str('deliveredOn')))}'),
          ),
        ),
        const SizedBox(height: Gap.md),
        SectionCard(
          title: canEdit ? 'Lines · tap one to mark a problem' : 'Lines',
          count: rows.length,
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            for (final (i, r) in first.take(5).indexed)
              PhoneRow(
                RowData(
                  title: '${r.no} · ${r.title}',
                  sub: [r.sub, r.values['note'] as String?],
                  badge: LineConditionEnum.badge(r.values['condition'] as String?) ?? const Badge('Not checked', Tone.neutral),
                  onTap: canEdit ? () => _after(openDeliveredLine(context, orderId: o.id, row: r, value: r.values)) : null,
                ),
                divider: i < first.length - 1 && i < 4,
              ),
            if (rows.length > 5)
              Align(alignment: Alignment.centerLeft, child: TextButton(onPressed: _allLines, child: Text('All ${rows.length} lines ›'))),
          ]),
        ),
        const SizedBox(height: Gap.md),
        SectionCard(
          title: 'Delivered',
          action: canEdit ? edit(() => _after(_details()), 'delivery') : null,
          child: Column(children: [
            KvRow('On', fmtDate(DateTime.tryParse(dd.str('deliveredOn'))) ?? 'not yet'),
            KvRow('Received by', dd.strOrNull('receivedBy') ?? '–'),
            if (dd.strOrNull('note') != null) KvRow('Note', dd.str('note')),
          ]),
        ),
        const SizedBox(height: Gap.md),
        SectionCard(
          title: 'SAT',
          action: canEdit ? edit(() => _after(_satDetails()), 'SAT') : null,
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            KvRow('Planned', fmtDate(DateTime.tryParse(dd.str('satPlannedOn'))) ?? '–'),
            KvRow('Our engineer', dd.at('satEngineer.name') ?? '–'),
            KvRow('Done', fmtDate(DateTime.tryParse(dd.str('satDoneOn'))) ?? 'not yet'),
            KvRow('Signed by', dd.strOrNull('satSignedBy') ?? '–'),
            if (satResult != null) Padding(padding: const EdgeInsets.only(top: Gap.sm), child: Align(alignment: Alignment.centerLeft, child: StatusBadge(satResult))),
            for (final (i, x) in sat.indexed)
              PhoneRow(RowData(title: x.str('item'), sub: [x.strOrNull('note')], badge: SatResultEnum.badge(x.str('result'))), divider: i < sat.length - 1),
            if (canEdit)
              Wrap(spacing: Gap.sm, children: [
                OutlinedButton(onPressed: () => _after(_satChecks()), child: Text(sat.isEmpty ? 'Add the checks' : 'Edit the checks')),
                if (sat.any((x) => x.str('result') != 'pass' && x.str('result') != 'not_applicable') || dd.strOrNull('satDoneOn') == null)
                  OutlinedButton(onPressed: () => _after(_allPassed()), child: const Text('All passed')),
              ]),
          ]),
        ),
        const SizedBox(height: Gap.md),
        SectionCard(
          title: 'Claims',
          count: claims.length,
          action: canEdit ? TextButton.icon(onPressed: () => _after(_claim()), icon: const Icon(Icons.add, size: 16), label: const Text('Claim')) : null,
          child: Column(children: [
            if (claims.isEmpty) Padding(padding: const EdgeInsets.symmetric(vertical: Gap.md), child: Text('No claims', style: context.text.bodySmall?.copyWith(color: c.muted))),
            for (final (i, x) in claims.indexed)
              PhoneRow(
                RowData(title: x.str('title'), sub: [x.strOrNull('detail'), 'opened ${fmtDate(x.date('openedOn'))}'], badge: ClaimStatusEnum.badge(x.str('status'))),
                divider: i < claims.length - 1,
              ),
          ]),
        ),
      ]),
    );
  }
}

/// One delivered line: how many came, in what condition, a note and a photo, and a claim when
/// something is wrong. Saved at once; answers the line's new values (null when closed).
Future<Json?> openDeliveredLine(BuildContext context, {required String orderId, required LineRow row, required Json value}) async {
  PickedFile? photo;
  Sent? sent;
  Json? answer;
  final what = '${row.no} · ${row.title}';
  final ok = await FormSheet.open(
    context,
    title: 'Line $what',
    save: 'Save the line',
    keeps: true,
    intro: joinParts(['ordered ${row.sub ?? ''}'.trim()]),
    initial: {
      'deliveredQty': _fmt(_n(value['deliveredQty'])) == '0' || _fmt(_n(value['deliveredQty'])).isEmpty ? _fmt(_n(value['quantity'])) : _fmt(_n(value['deliveredQty'])),
      'condition': value['condition'] ?? 'good',
      'note': value['note'] ?? '',
      'openClaim': false,
      'claimTitle': '',
      'claimDetail': '',
    },
    groups: [
      FormGroup(fields: [
        const FieldDef('deliveredQty', 'Delivered', FieldKind.decimal, required: true),
        FieldDef('condition', 'Condition', FieldKind.choice, options: LineConditionEnum.labels),
        const FieldDef('note', 'What is wrong', FieldKind.text, max: 200, hint: 'e.g. guard door dented'),
        const FieldDef('openClaim', 'Open a claim for it', FieldKind.toggle),
        FieldDef('claimTitle', 'Claim', FieldKind.text, required: true, max: 160, showIf: (v) => v['openClaim'] == true),
        FieldDef('claimDetail', 'Details', FieldKind.multiline, max: 4000, showIf: (v) => v['openClaim'] == true),
      ]),
    ],
    onChange: (v, key) {
      // The claim's title says which line and what happened, until it is typed.
      if ((key == 'openClaim' || key == 'condition') && v['openClaim'] == true && '${v['claimTitle'] ?? ''}'.trim().isEmpty) {
        v['claimTitle'] = 'Line $what ${(LineConditionEnum.label(v['condition'] as String?) ?? 'damaged').toLowerCase()}';
      }
    },
    extra: (setState) => FileTile(label: 'Photo', add: 'Take a photo of it', picked: photo, onPicked: (p) => setState(() => photo = p)),
    send: (api, body) async {
      final cond = body['condition'] as String?;
      final line = {'set': 'delivered', 'deliveredQty': _n(body['deliveredQty']) ?? 0, 'condition': cond, 'note': '${body['note'] ?? ''}'.trim()};
      // The line, its photo and the claim: sent now, or kept on the phone and sent in order later.
      final ch = context.outbox.chain('Delivery line ${row.no} · ${LineConditionEnum.label(cond) ?? ''}'.trim());
      ch.patch('/api/order-lines/${row.key}', line);
      if (photo != null) {
        ch.upload('/api/orders/$orderId/files', photo!.bytes, photo!.name, fields: {'step': 'delivery', 'kind': 'photo', 'note': 'Line ${row.no}'});
      }
      if (body['openClaim'] == true) {
        ch.post('/api/orders/$orderId/claims', {'title': '${body['claimTitle']}'.trim(), 'detail': '${body['claimDetail'] ?? ''}'.trim(), 'openedOn': _today()});
      }
      sent = await ch.send();
      photo = null;
      // With no answer yet, the line shows what was typed.
      final dl = sent!.first?.objAt('line.delivered');
      answer = {'deliveredQty': dl?.strOrNull('qty') ?? '${line['deliveredQty']}', 'condition': dl?.strOrNull('condition') ?? cond, 'note': dl?.strOrNull('note') ?? line['note']};
      return sent!.first;
    },
  );
  if (ok && context.mounted) savedToast(context, sent!, 'Line ${row.no} saved');
  return ok ? answer : null;
}

/// A new claim on the order (against the factory, the forwarder or insurance: said in the details).
Future<bool> openClaim(BuildContext context, {required String orderId, String? title}) => FormSheet.open(
      context,
      title: 'New claim',
      save: 'Open the claim',
    keeps: true,
      initial: {'title': title ?? '', 'detail': '', 'openedOn': _today()},
      groups: const [
        FormGroup(fields: [
          FieldDef('title', 'What is wrong', FieldKind.text, required: true, max: 160),
          FieldDef('detail', 'Details', FieldKind.multiline, max: 4000, hint: 'Who it is against, what you want done'),
          FieldDef('openedOn', 'Opened on', FieldKind.date, required: true),
        ]),
      ],
      send: (api, body) => sendOrKeep(context, 'New claim · ${body['title']}', 'POST', '/api/orders/$orderId/claims', body),
    );
