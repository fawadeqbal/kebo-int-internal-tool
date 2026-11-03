import 'package:flutter/material.dart' hide Badge;

import '../core/api.dart';
import '../core/json.dart';
import '../core/scope.dart';
import '../ds/ds.dart';
import '../generated/models.g.dart';
import '../generated/ticks.g.dart';
import 'delivery.dart';
import 'links.dart';
import 'money.dart';
import 'order_lines.dart';

const _stepTone = {'done': Tone.ok, 'late': Tone.bad, 'now': Tone.info};

/// The order's steps as chips (✓ Payment 3/3 · Factory 1/2 late …), the item to do now with
/// the page's one primary button, and the chosen step's checklist. A tap on a row ticks it,
/// asking only what that item needs (spec/ticks.yaml).
class OrderFlow extends StatefulWidget {
  const OrderFlow(this.order, {super.key, required this.title});
  final Order order;
  final String title;

  @override
  State<OrderFlow> createState() => _OrderFlowState();
}

class _OrderFlowState extends State<OrderFlow> {
  Json? steps, flow, defaults;
  String? error, step;
  final _selectedChip = GlobalKey();

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (steps == null && error == null) _load();
  }

  Future<void> _load() async {
    final api = context.api;
    final id = widget.order.id;
    try {
      final r = await Future.wait([
        api.get('/api/orders/$id/steps'),
        api.get('/api/orders/$id/flow').catchError((_) => <String, dynamic>{}),
        api.get('/api/orders/$id/defaults').catchError((_) => <String, dynamic>{}),
      ]);
      if (!mounted) return;
      setState(() {
        steps = r[0];
        flow = r[1];
        defaults = r[2];
        // Start on the step that has something to do now, else the first not done.
        step ??= r[0].at('doNow.step') ??
            r[0].list('steps', (m) => m).firstWhere((s) => s.str('state') != 'done', orElse: () => const {}).strOrNull('key') ??
            'payment';
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => error = e.message);
    }
  }

  /// After a change: this section and the record (money, papers, files) read again.
  /// An empty [message]: the form already said what happened (e.g. with "Share receipt").
  Future<void> _changed(String message) async {
    if (message.isNotEmpty) toast(context, message);
    await _load();
    if (mounted) await RecordScope.reloadOf(context);
  }

  Json? _item(String? key, String? id) =>
      steps!.list('items', (m) => m).where((i) => (id != null && i.strOrNull('id') == id) || (key != null && i.strOrNull('key') == key)).firstOrNull;

  Future<void> _open(Json item) async {
    final done = await tickItem(context, widget.order, item, flow: flow ?? const {}, defaults: defaults ?? const {}, canEdit: steps!.boolean('canEdit'));
    if (done != null && mounted) await _changed(done);
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final s = steps;
    if (s == null) {
      return SectionCard(
        title: widget.title,
        child: error == null
            ? const Padding(padding: EdgeInsets.all(Gap.lg), child: LoadingView())
            : Padding(padding: const EdgeInsets.symmetric(vertical: Gap.md), child: MessageBanner(error!, tone: Tone.bad)),
      );
    }
    final all = s.list('steps', (m) => m);
    final current = all.where((x) => x.str('key') == step).firstOrNull ?? (all.isEmpty ? null : all.first);
    final items = s.list('items', (m) => m).where((i) => i.str('step') == current?.str('key')).toList();
    final now = s.obj('doNow', (m) => m);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (now != null) ...[
        _DoNow(now: now, onFill: () {
          final item = _item(now.strOrNull('key'), now.strOrNull('id'));
          if (item != null) _open(item);
        }),
        const SizedBox(height: Gap.md),
      ],
      // Every step is built (a handful), so all of them are in reach of a screen reader.
      SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(children: [
          for (final x in all)
            Padding(
              padding: const EdgeInsets.only(right: Gap.sm),
              child: _StepChip(
                key: x == current ? _selectedChip : null,
                step: x,
                selected: x == current,
                onTap: () {
                  setState(() => step = x.str('key'));
                  // Bring the chosen chip fully into view.
                  WidgetsBinding.instance.addPostFrameCallback((_) {
                    final ctx = _selectedChip.currentContext;
                    if (ctx != null) Scrollable.ensureVisible(ctx, duration: const Duration(milliseconds: 200), alignment: 0.5);
                  });
                },
              ),
            ),
        ]),
      ),
      const SizedBox(height: Gap.sm),
      if (current != null)
        SectionCard(
          title: '${current.str('label')} · ${current.integer('done')} of ${current.integer('total')}',
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            if (current.strOrNull('line') != null)
              Padding(
                padding: const EdgeInsets.only(top: Gap.sm),
                child: Text(current.str('line'), style: context.text.bodySmall?.copyWith(color: c.text2)),
              ),
            for (final (i, it) in items.indexed) _ItemRow(item: it, onTap: () => _open(it), divider: i < items.length - 1),
            if (items.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: Gap.md),
                child: Text('Nothing to do in this step.', style: context.text.bodySmall?.copyWith(color: c.muted)),
              ),
          ]),
        ),
    ]);
  }
}

/// "Do now · Factory order: Advance paid to the factory", what it needs, when, and Fill it.
class _DoNow extends StatelessWidget {
  const _DoNow({required this.now, required this.onFill});
  final Json now;
  final VoidCallback onFill;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final late = now.boolean('late');
    return Container(
      padding: const EdgeInsets.all(Gap.lg),
      decoration: BoxDecoration(
        color: c.surface,
        borderRadius: BorderRadius.circular(Gap.radius),
        border: Border.all(color: late ? c.bad : c.primary, width: 1.5),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('DO NOW · ${now.str('label').toUpperCase()}', style: context.text.labelSmall?.copyWith(color: c.muted, letterSpacing: 0.6)),
        const SizedBox(height: Gap.xs),
        Semantics(header: true, child: Text(now.str('title'), style: context.text.titleMedium)),
        if (now.strOrNull('needs') != null) ...[
          const SizedBox(height: 2),
          Text(now.str('needs'), style: context.text.bodySmall?.copyWith(color: c.text2)),
        ],
        if (now.date('dueOn') != null) ...[
          const SizedBox(height: 2),
          Text('${late ? 'Was due' : 'Due'} ${fmtDate(now.date('dueOn'))}${late ? ' · late' : ''}',
              style: context.text.bodySmall?.copyWith(color: late ? c.bad : c.text2, fontWeight: late ? FontWeight.w600 : null)),
        ],
        const SizedBox(height: Gap.md),
        FilledButton(onPressed: onFill, child: const Text('Fill it')),
      ]),
    );
  }
}

class _StepChip extends StatelessWidget {
  const _StepChip({super.key, required this.step, required this.selected, required this.onTap});
  final Json step;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final state = step.str('state');
    final tone = _stepTone[state];
    final done = state == 'done';
    final label = '${done ? '✓ ' : ''}${step.str('label')} ${step.integer('done')}/${step.integer('total')}${state == 'late' ? ' · late' : ''}';
    return Semantics(
      button: true,
      selected: selected,
      label: 'Step ${step.integer('number')}, ${step.str('label')}, ${step.integer('done')} of ${step.integer('total')} done, ${step.str('stateLabel')}',
      excludeSemantics: true,
      onTap: onTap,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(999),
        child: Container(
          constraints: const BoxConstraints(minHeight: Gap.tap),
          alignment: Alignment.center,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            decoration: BoxDecoration(
              color: selected ? c.primarySoft : (tone == null ? c.surface : c.soft(tone)),
              borderRadius: BorderRadius.circular(999),
              border: Border.all(color: selected ? c.primary : c.line, width: selected ? 1.5 : 1),
            ),
            child: Text(label,
                style: context.text.labelMedium?.copyWith(color: selected ? c.primary : (tone == null ? c.text : c.fg(tone)), fontWeight: FontWeight.w600)),
          ),
        ),
      ),
    );
  }
}

/// One checklist row: done / to do / late / skipped, its data, who and when.
class _ItemRow extends StatelessWidget {
  const _ItemRow({required this.item, required this.onTap, this.divider = true});
  final Json item;
  final VoidCallback onTap;
  final bool divider;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final done = item.boolean('done');
    final skipped = item.boolean('skipped');
    final late = item.boolean('late') && !done;
    final data = [for (final p in (item['data'] as List<dynamic>? ?? const [])) if (p is List && p.length == 2) _value('${p[1]}')];
    final icon = skipped
        ? Icon(Icons.remove_circle_outline, color: c.muted, size: 22)
        : done
            ? Icon(Icons.check_circle, color: c.ok, size: 22)
            : Icon(Icons.radio_button_unchecked, color: late ? c.bad : c.lineStrong, size: 22);
    final state = skipped ? 'Skipped' : done ? 'Done' : late ? 'Late' : 'To do';
    return PhoneRow(
      RowData(
        title: item.str('title'),
        sub: [
          if (skipped) 'skipped: ${item.strOrNull('skipReason') ?? ''}' else ...data,
          if (!done && item.strOrNull('needs') != null) item.str('needs'),
          item.at('assignee.name'),
          if (!done && item.date('dueOn') != null) '${late ? 'was due' : 'due'} ${fmtDate(item.date('dueOn'))}',
        ],
        leading: Semantics(label: state, child: icon),
        strong: !done && !skipped,
        onTap: onTap,
      ),
      divider: divider,
    );
  }

  /// "2026-10-30" in a data pair reads as "30 Oct 2026".
  static String _value(String v) => RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(v) ? fmtDate(DateTime.parse(v)) ?? v : v;
}

/// Ticks [item]: asks what it needs, saves it where it lives, and returns the toast to show
/// (null when nothing changed). Done items open what they hold, with Untick or Skip.
Future<String?> tickItem(BuildContext context, Order order, Json item,
    {required Json flow, required Json defaults, required bool canEdit}) async {
  final key = item.strOrNull('key');
  final id = item.strOrNull('id');
  final title = item.str('title');
  final pattern = key == null ? null : (key.startsWith('doc:') ? 'doc:*' : key.startsWith('bank:') ? 'bank:*' : key);
  final web = key == null ? null : tickOnWeb[key];
  final form = web == null && pattern != null ? tickForms[pattern] : null;

  // Line tasks: every line of the order in the line list.
  if (canEdit && !item.boolean('skipped') && (key == 'goods_received' || key == 'packing_list')) {
    try {
      final o = await context.api.get('/api/orders/${order.id}');
      if (!context.mounted) return null;
      final lines = o.list('lines', (m) => m);
      final saved = key == 'goods_received'
          ? await openGoodsReceived(context, order.id, order.refNo, lines)
          : await openPacking(context, order.id, order.refNo, lines);
      return saved ? 'Saved · $title' : null;
    } on ApiException catch (e) {
      if (context.mounted) toast(context, e.message);
      return null;
    }
  }
  // Money: the same forms as the order's Money section; saving them ticks the item.
  final open = !item.boolean('done') && !item.boolean('skipped');
  if (open && (key == 'deposit_in' || key == 'balance_in' || key == 'bank:bank_paid_us')) {
    if (!canAddMoney(context)) {
      await _info(context, order, title, 'Money received is added by people who handle payments.', item);
      return null;
    }
    return await openMoneyReceived(context, orderId: order.id, refNo: order.refNo ?? '', customer: order.customer?.name) ? '' : null;
  }
  // Delivery & SAT: one screen for what arrived, the SAT and claims.
  if (key == 'delivered' || key == 'sat_done' || key == 'claims_closed') {
    return await openDelivery(context, order) ? 'Saved' : null;
  }
  if (open && (key == 'factory_advance' || key == 'factory_paid')) {
    try {
      final money = await context.api.get('/api/orders/${order.id}/money');
      if (!context.mounted) return null;
      if (!money.boolAt('factories.canRecord')) {
        await _info(context, order, title, 'Payments to factories are recorded by managers.', item);
        return null;
      }
      return await openFactoryPayment(context, orderId: order.id, refNo: order.refNo ?? '', money: money) ? '' : null;
    } on ApiException catch (e) {
      if (context.mounted) toast(context, e.message);
      return null;
    }
  }
  if (!canEdit) {
    await _info(context, order, title, 'You can see this order but not change it.', item);
    return null;
  }
  if (item.boolean('done') || item.boolean('skipped')) {
    return _doneSheet(context, order, item);
  }
  // Own items: the company's checklist.
  if (key == null && id != null) {
    final tool = item.strOrNull('tool') ?? 'done';
    if (tool == 'done') {
      return _post(context, '/api/checklist/$id/tick', {'data': <String, String>{}}, 'Ticked · $title');
    }
    if (tool == 'fill') {
      final fields = [
        for (final f in item.list('fields', (m) => m))
          if (f.str('type') != 'file')
            FieldDef(f.str('key'), f.str('label'), f.str('type') == 'date' ? FieldKind.date : f.str('type') == 'number' ? FieldKind.decimal : FieldKind.text,
                required: true, max: 500),
      ];
      final ok = await FormSheet.open(
        context,
        title: title,
        save: 'Tick it',
        intro: order.refNo,
        initial: {
          for (final f in item.list('fields', (m) => m))
            f.str('key'): (item['values'] as Map?)?[f.str('key')] ?? (f.str('type') == 'date' ? _today() : null),
        },
        groups: [FormGroup(fields: fields)],
        send: (api, body) => api.post('/api/checklist/$id/tick', {'data': {for (final e in body.entries) if (e.value != null) e.key: '${e.value}'}}),
      );
      return ok ? 'Ticked · $title' : null;
    }
    if (tool == 'upload') {
      final picked = await pickFile(context);
      if (picked == null || !context.mounted) return null;
      try {
        final up = await context.api.upload('/api/orders/${order.id}/files',
            bytes: picked.bytes, fileName: picked.name, fields: {'step': item.str('step'), 'attachTo': 'checklist:$id'});
        if (!context.mounted) return null;
        return await _post(context, '/api/checklist/$id/tick', {'data': <String, String>{}, 'attachmentId': up.str('sourceId')}, 'Ticked · $title');
      } on ApiException catch (e) {
        if (context.mounted) toast(context, e.message);
        return null;
      }
    }
    await _info(context, order, title, 'This item is done on the web (it makes or pays something).', item);
    return null;
  }
  if (form == null) {
    await _info(context, order, title, web ?? 'This item is done on the web for now.', item);
    return null;
  }

  // An automatic item: ask what it needs, write it where it lives.
  final kind = key!.startsWith('doc:') ? key.substring(4) : null;
  final bank = key.startsWith('bank:') ? key.substring(5) : null;
  final shipmentId = flow.at('shipping.shipments.0.id');
  final sources = {'flow': flow, 'defaults': defaults, 'order': order.toJson()..addAll({'blNo': flow.at('shipping.shipments.0.blNo')})};
  final initial = <String, Object?>{
    for (final e in form.prefill.entries) e.key: _first(e.value, sources),
  };
  String fill(String s) => s.replaceAll('{order}', order.id).replaceAll('{kind}', kind ?? '').replaceAll('{step}', bank ?? '');
  final send = {for (final e in form.send.entries) e.key: e.value is String ? fill(e.value as String) : e.value};
  PickedFile? pages;

  final ok = await FormSheet.open(
    context,
    title: title,
    save: 'Tick it',
    intro: joinParts([order.refNo, form.hint]),
    initial: initial,
    groups: [
      FormGroup(fields: form.fields),
    ],
    extra: form.file == null
        ? null
        : (setState) => FileTile(
              label: form.file!.kind == 'photo' ? 'Photos' : 'The paper',
              add: form.file!.kind == 'photo' ? 'Add a photo' : 'Snap or attach it',
              picked: pages,
              onPicked: (p) => setState(() => pages = p)),
    send: (api, body) async {
      final answers = {...send, ...body};
      // The file goes up first: its id may be part of the answer.
      if (pages != null) {
        final up = await api.upload('/api/orders/${order.id}/files',
            bytes: pages!.bytes,
            fileName: pages!.name,
            fields: {'step': form.file!.step, 'kind': form.file!.kind, if (form.file!.asField == null) 'attachTo': 'checklist:$key'});
        if (form.file!.asField != null) answers[form.file!.asField!] = up.str('sourceId');
      }
      var path = fill(form.path);
      var method = form.method;
      if (path.contains('{shipment}')) {
        if (shipmentId == null) {
          // No shipment yet: this makes Shipment 1.
          path = '/api/orders/${order.id}/shipments';
          method = 'POST';
          answers['mode'] = 'sea';
        } else {
          path = path.replaceAll('{shipment}', shipmentId);
        }
      }
      if (key == 'ready_date') {
        // One date for every factory of the order.
        return api.patch(path, {'readyOn': answers['readyOn']});
      }
      return switch (method) {
        'PUT' => api.put(path, answers),
        'PATCH' => api.patch(path, answers),
        _ => api.post(path, answers),
      };
    },
  );
  return ok ? 'Ticked · $title' : null;
}

Object? _first(List<String> sources, Map<String, Json> from) {
  for (final s in sources) {
    if (s == 'today') return _today();
    final dot = s.indexOf('.');
    final v = from[s.substring(0, dot)]?.at(s.substring(dot + 1));
    if (v != null) return v;
  }
  return null;
}

String _today() => DateTime.now().toIso8601String().substring(0, 10);

Future<String?> _post(BuildContext context, String path, Json body, String done) async {
  try {
    await context.api.post(path, body);
    return done;
  } on ApiException catch (e) {
    if (context.mounted) toast(context, e.message);
    return null;
  }
}

/// A done or skipped item: what it holds, and Untick / Skip / Un-skip where allowed.
Future<String?> _doneSheet(BuildContext context, Order order, Json item) async {
  final id = item.strOrNull('id');
  final key = item.strOrNull('key');
  final skipped = item.boolean('skipped');
  final action = await showModalBottomSheet<String>(
    context: context,
    useRootNavigator: true,
    builder: (ctx) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(Gap.lg, 0, Gap.lg, Gap.lg),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Semantics(header: true, child: Text(item.str('title'), style: ctx.text.titleLarge)),
          Text(skipped ? 'Skipped: ${item.strOrNull('skipReason') ?? ''}' : 'Done${item.date('doneOn') == null ? '' : ' ${fmtDate(item.date('doneOn'))}'}',
              style: ctx.text.bodySmall?.copyWith(color: ctx.colors.text2)),
          const SizedBox(height: Gap.sm),
          for (final p in (item['data'] as List<dynamic>? ?? const []))
            if (p is List && p.length == 2) KvRow('${p[0]}', _ItemRow._value('${p[1]}')),
          const SizedBox(height: Gap.md),
          if (skipped && key != null) OutlinedButton(onPressed: () => Navigator.pop(ctx, 'unskip'), child: const Text('Do it after all')),
          if (!skipped && id != null && key == null) OutlinedButton(onPressed: () => Navigator.pop(ctx, 'untick'), child: const Text('Untick')),
          if (!skipped && key != null)
            Text('It ticked itself from the order\'s data. Change that data to change it.', style: ctx.text.bodySmall?.copyWith(color: ctx.colors.muted)),
        ]),
      ),
    ),
  );
  if (action == null || !context.mounted) return null;
  if (action == 'untick') return _post(context, '/api/checklist/$id/untick', const {}, 'Unticked');
  try {
    await context.api.put('/api/orders/${order.id}/checklist/auto/$key', {'skipped': false});
    return 'Back on the list';
  } on ApiException catch (e) {
    if (context.mounted) toast(context, e.message);
    return null;
  }
}

/// An item the phone shows but does not tick yet: why, what it holds, Skip, and Open on the web.
Future<void> _info(BuildContext context, Order order, String title, String why, Json item) => showModalBottomSheet<void>(
      context: context,
      useRootNavigator: true,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(Gap.lg, 0, Gap.lg, Gap.lg),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Semantics(header: true, child: Text(title, style: ctx.text.titleLarge)),
            const SizedBox(height: Gap.sm),
            MessageBanner(why),
            if (item.strOrNull('needs') != null) ...[const SizedBox(height: Gap.sm), KvRow('Needs', item.str('needs'))],
            const SizedBox(height: Gap.md),
            OutlinedButton(
              onPressed: () {
                Navigator.pop(ctx);
                openWeb(context, '/orders/${order.id}');
              },
              child: const Text('Open on the web'),
            ),
          ]),
        ),
      ),
    );

/// "Pages or photo" under a tick form: optional, one file, the camera first.
