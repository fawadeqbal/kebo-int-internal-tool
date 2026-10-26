import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/format.dart' as f;
import '../../core/json.dart';
import '../../core/labels.dart';
import '../../core/refresh.dart';
import '../../core/session.dart';
import '../../theme/colors.dart';
import '../../ui/docs.dart';
import '../../ui/kit.dart';

/// GET /api/orders/:id.
final orderProvider = FutureProvider.autoDispose.family<Json, String>((ref, id) {
  ref.watch(dataVersionProvider);
  return ref.read(repoProvider).order(id);
});

/// GET /api/orders/:id/payments (read-only on the phone).
final orderPaymentsProvider = FutureProvider.autoDispose.family<Json, String>((ref, id) {
  ref.watch(dataVersionProvider);
  return ref.read(repoProvider).payments(id);
});

/// An order: where it is (Confirmed → In production → Shipped → Done), what it needs now,
/// the one button that moves it, its money, details, history and documents.
class OrderDetailScreen extends ConsumerWidget {
  const OrderDetailScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(orderProvider(id));
    return Scaffold(
      appBar: AppBar(title: Text(data.value?.s('refNo') ?? 'Order', style: mono13(context).copyWith(fontSize: 17, fontWeight: FontWeight.w600))),
      body: data.when(
        // After a move the order reloads in place: the screen (and its dialogs) stay put.
        skipLoadingOnReload: true,
        loading: () => const LoadingView(),
        error: (e, _) => ErrorState(e, onRetry: () => ref.invalidate(orderProvider(id))),
        data: (o) => RefreshIndicator(
          onRefresh: () async => ref.read(dataVersionProvider.notifier).bump(),
          child: ListView(padding: pagePadding, children: [
            _Header(o: o),
            gap12,
            OrderStageBar(stage: o.s('stage'), history: o.l('history'), cancelled: o.s('status') == 'cancelled'),
            gap12,
            _StageCard(o: o),
            _MoneyCard(o: o),
            _DetailsCard(o: o),
            _DocumentsCard(o: o),
            _HistoryCard(o: o),
            const WebNote('Payments are recorded on the web (accounts). Dates and the B/L can be corrected there too.'),
          ]),
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.o});
  final Json o;
  @override
  Widget build(BuildContext context) {
    final deal = o.m('inquiry');
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(o.m('customer').s('name'), style: context.t.titleLarge),
      gap4,
      InkWell(
        onTap: () => context.push('/deals/${deal.s('id')}'),
        child: Text('${deal.s('refNo')} · ${deal.s('title')}', style: context.t.bodySmall!.copyWith(color: context.c.primary)),
      ),
    ]);
  }
}

/* ---------------------------------------------------------------- stage bar */

/// The four stages in a row: done ones ticked, the current one highlighted, each with the
/// day the order entered it (from `history`).
class OrderStageBar extends StatelessWidget {
  const OrderStageBar({super.key, required this.stage, this.history = const [], this.cancelled = false});
  final String stage;
  final List<Json> history;
  final bool cancelled;

  /// The day the order last entered [s], if it has been there.
  String? enteredOn(String s) {
    for (final h in history.reversed) {
      if (h.s('to') == s) return h.sn('at');
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final current = orderStages.indexOf(stage);
    return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      for (var i = 0; i < orderStages.length; i++)
        Expanded(
          child: Builder(builder: (context) {
            final s = orderStages[i];
            final done = i < current;
            final here = i == current;
            final on = cancelled ? c.muted : c.primarySolid;
            final day = i <= current ? enteredOn(s) : null;
            final label = orderStageLabel[s] ?? s;
            return Semantics(
              key: ValueKey('stage-$s'),
              label: '$label${here ? ', current stage' : done ? ', done' : ''}${day != null ? ', since ${f.date(day)}' : ''}',
              excludeSemantics: true,
              child: Column(children: [
                Row(children: [
                  Expanded(child: Container(height: 2, color: i == 0 ? Colors.transparent : (i <= current ? on : c.line))),
                  Container(
                    width: here ? 28 : 22,
                    height: here ? 28 : 22,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: done ? on : (here ? c.primarySoft : c.surface),
                      border: Border.all(color: done || here ? on : c.lineStrong, width: here ? 2.5 : 1.5),
                    ),
                    child: done
                        ? const Icon(Icons.check_rounded, size: 14, color: Colors.white)
                        : here
                            ? Container(width: 10, height: 10, decoration: BoxDecoration(shape: BoxShape.circle, color: on))
                            : null,
                  ),
                  Expanded(child: Container(height: 2, color: i == orderStages.length - 1 ? Colors.transparent : (i < current ? on : c.line))),
                ]),
                const SizedBox(height: 6),
                Text(
                  label,
                  textAlign: TextAlign.center,
                  maxLines: 2,
                  style: context.t.bodySmall!.copyWith(
                    fontWeight: here ? FontWeight.w700 : FontWeight.w500,
                    color: here ? (cancelled ? c.muted : c.primary) : (done ? c.text : c.muted),
                  ),
                ),
                if (day != null) Text(f.shortDate(day), textAlign: TextAlign.center, style: context.t.bodySmall!.copyWith(fontSize: 11)),
              ]),
            );
          }),
        ),
    ]);
  }
}

/* ---------------------------------------------------------------- the button */

class _StageCard extends ConsumerWidget {
  const _StageCard({required this.o});
  final Json o;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final canMove = ref.watch(sessionProvider).can('orders.update');
    final stage = o.s('stage');
    final needs = o.mn('needs');
    final next = o.mn('next');
    final back = o.mn('back');
    final cancelled = o.mn('cancelled');
    final late = needs?.b('late') ?? false;
    final c = context.c;
    return SectionCard(
      title: cancelled != null ? 'Cancelled' : orderStageLabel[stage] ?? stage,
      subtitle: cancelled != null ? null : 'Since ${f.date(o.sn('stageSince'))}',
      trailing: cancelled != null ? const ToneBadge('Cancelled', tone: Tone.outline) : orderStageBadge(stage),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (cancelled != null)
          Notice('Cancelled ${f.date(cancelled.sn('at'))}: ${cancelled.s('reason')}', tone: Tone.bad)
        else
          Text(orderStageHint[stage] ?? '', style: context.t.bodyMedium!.copyWith(color: c.text2)),
        if (needs != null) ...[
          gap12,
          Container(
            key: const ValueKey('needs'),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: late ? c.tone(Tone.bad).$1 : c.surface2,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: late ? c.bad.withValues(alpha: 0.35) : c.line),
            ),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Icon(late ? Icons.schedule_rounded : Icons.flag_outlined, size: 18, color: late ? c.bad : c.primary),
              gap8,
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('NEEDS NOW', style: TextStyle(fontFamily: 'Geist', fontSize: 10.5, letterSpacing: 1.1, fontWeight: FontWeight.w700, color: late ? c.bad : c.primary)),
                  const SizedBox(height: 2),
                  Text(needs.s('title'), style: context.t.bodyMedium!.copyWith(fontWeight: FontWeight.w600)),
                  Text(
                    late ? 'Was due ${f.date(needs.s('due'))}' : 'By ${f.date(needs.s('due'))}',
                    style: context.t.bodySmall!.copyWith(color: late ? c.bad : null, fontWeight: late ? FontWeight.w600 : null),
                  ),
                ]),
              ),
              if (late) const ToneBadge('Late', tone: Tone.bad),
            ]),
          ),
        ],
        if (canMove && next != null) ...[
          gap16,
          SizedBox(
            height: 52,
            child: BusyButton(key: const ValueKey('next'), label: next.s('label'), icon: Icons.arrow_forward_rounded, onPressed: () => advanceOrder(context, ref, o)),
          ),
          Padding(padding: const EdgeInsets.only(top: 6), child: Text('Moves the order to ${next.s('stage', orderStageLabel[next.s('to')] ?? '')}.', textAlign: TextAlign.center, style: context.t.bodySmall)),
        ],
        if (canMove && back != null) ...[
          gap4,
          Center(
            child: BusyButton(
              key: const ValueKey('back'),
              label: back.s('label'),
              icon: Icons.undo_rounded,
              style: BusyStyle.text,
              expand: false,
              onPressed: () => moveOrderBack(context, ref, o),
            ),
          ),
        ],
        if (!canMove && cancelled == null) ...[gap12, Text('Only the people handling this deal can move the order.', style: context.t.bodySmall)],
      ]),
    );
  }
}

/// The big button: asks what the next stage needs (ready date, ship date and B/L), then moves.
Future<void> advanceOrder(BuildContext context, WidgetRef ref, Json o) async {
  final next = o.m('next');
  final to = next.s('to');
  StageExtras? extras = const StageExtras();
  if (to == 'in_production') {
    extras = await askProductionStart(context, readyOn: o.sn('readyOn'));
  } else if (to == 'shipped') {
    extras = await askShipped(context, blNo: o.sn('blNo'), shippedOn: o.sn('shippedOn'));
  }
  if (extras == null || !context.mounted) return;
  await sendMove(context, ref, o.s('id'), to, extras);
}

/// "Back to …": one stage back, after a quick check (with an optional note).
Future<void> moveOrderBack(BuildContext context, WidgetRef ref, Json o) async {
  final back = o.m('back');
  final to = back.s('to');
  final note = await showDialog<String>(
    context: context,
    builder: (_) => NoteDialog(
      title: 'Move back to ${orderStageLabel[to] ?? to}?',
      message: 'Use this when the order was moved by mistake or something went wrong. The move is kept in the history.',
      action: 'Move back',
      noteHint: 'Why? (optional)',
    ),
  );
  if (note == null || !context.mounted) return;
  await sendMove(context, ref, o.s('id'), to, StageExtras(note: note));
}

/// What a move can carry besides the stage.
class StageExtras {
  const StageExtras({this.note, this.readyOn, this.shippedOn, this.blNo});
  final String? note;
  final String? readyOn;
  final String? shippedOn;
  final String? blNo;
}

/// Sends the move. When the server warns (409 code "confirm") the warning is shown with
/// "Go ahead anyway", which sends it again with `confirm: true` and the note given there.
Future<bool> sendMove(BuildContext context, WidgetRef ref, String orderId, String to, StageExtras x, {bool confirmed = false}) async {
  final repo = ref.read(repoProvider);
  try {
    await ref.mutate(() => repo.moveOrder(orderId, to, confirm: confirmed, note: x.note, readyOn: x.readyOn, shippedOn: x.shippedOn, blNo: x.blNo));
    if (context.mounted) toast(context, 'Moved to ${orderStageLabel[to] ?? to}.');
    return true;
  } on ApiException catch (e) {
    if (!context.mounted) return false;
    if (e.needsConfirm && !confirmed) {
      final note = await showDialog<String>(
        context: context,
        builder: (_) => NoteDialog(
          title: 'Before it goes to ${orderStageLabel[to] ?? to}',
          message: e.message,
          warning: true,
          action: 'Go ahead anyway',
          noteHint: 'Why go ahead? e.g. the customer sent the bank slip (optional)',
          initialNote: x.note,
        ),
      );
      if (note == null || !context.mounted) return false;
      return sendMove(context, ref, orderId, to, StageExtras(note: note, readyOn: x.readyOn, shippedOn: x.shippedOn, blNo: x.blNo), confirmed: true);
    }
    if (e.status == 409 || e.status == 400) {
      // Someone else moved it, or the date is not allowed: say so and show the order as it is now.
      ref.read(dataVersionProvider.notifier).bump();
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Not moved'),
          content: Text(e.message),
          actions: [FilledButton(onPressed: () => Navigator.pop(ctx), child: const Text('OK'))],
        ),
      );
      return false;
    }
    toast(context, e.message, error: true);
    return false;
  }
}

/// A short dialog with an optional note. Returns the note ('' for none), or null when cancelled.
/// With [warning], it is the server's warning before a move ("Go ahead anyway").
class NoteDialog extends StatefulWidget {
  const NoteDialog({super.key, required this.title, required this.message, required this.action, this.noteHint = 'Note (optional)', this.warning = false, this.initialNote});
  final String title;
  final String message;
  final String action;
  final String noteHint;
  final bool warning;
  final String? initialNote;
  @override
  State<NoteDialog> createState() => _NoteDialogState();
}

class _NoteDialogState extends State<NoteDialog> {
  late final _note = TextEditingController(text: widget.initialNote ?? '');

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return AlertDialog(
      icon: widget.warning ? Icon(Icons.warning_amber_rounded, color: c.warn, size: 30) : null,
      title: Text(widget.title),
      content: SingleChildScrollView(
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(widget.message, style: context.t.bodyMedium!.copyWith(color: widget.warning ? c.text : c.text2)),
          gap16,
          TextField(
            key: const ValueKey('note'),
            controller: _note,
            minLines: 1,
            maxLines: 4,
            decoration: InputDecoration(hintText: widget.noteHint),
          ),
        ]),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text('Cancel', style: TextStyle(color: c.text2))),
        FilledButton(
          style: widget.warning ? FilledButton.styleFrom(backgroundColor: c.warn) : null,
          onPressed: () => Navigator.pop(context, _note.text.trim()),
          child: Text(widget.action),
        ),
      ],
    );
  }
}

/// To In production: the ready date the factory gave, if known.
Future<StageExtras?> askProductionStart(BuildContext context, {String? readyOn}) {
  var ready = readyOn ?? '';
  final note = TextEditingController();
  return showSheet<StageExtras>(
    context,
    title: 'Start production',
    subtitle: orderStageHint['in_production'],
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setState) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        DateField(
          label: 'Ready date from the factory',
          optional: true,
          clearable: true,
          helper: 'You will be reminded on this day. Leave it empty if the factory has not said.',
          value: ready,
          onChanged: (v) => setState(() => ready = v),
        ),
        Field(label: 'Note', optional: true, controller: note, maxLines: 3),
        FilledButton.icon(
          key: const ValueKey('sheet-go'),
          onPressed: () => Navigator.pop(ctx, StageExtras(readyOn: ready, note: note.text)),
          icon: const Icon(Icons.arrow_forward_rounded, size: 18),
          label: const Text('Start production'),
        ),
      ]),
    ),
  );
}

/// To Shipped: the ship date (today unless changed) and the B/L number.
Future<StageExtras?> askShipped(BuildContext context, {String? blNo, String? shippedOn}) {
  // Shipped again after a move back: start from the real ship date, not today.
  var shipped = shippedOn ?? f.today();
  String? error;
  final bl = TextEditingController(text: blNo ?? '');
  final note = TextEditingController();
  return showSheet<StageExtras>(
    context,
    title: 'Mark as shipped',
    subtitle: orderStageHint['shipped'],
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setState) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        DateField(label: 'Ship date', value: shipped, error: error, onChanged: (v) => setState(() => shipped = v)),
        Field(label: 'B/L number', optional: true, controller: bl, mono: true, hint: 'e.g. QDLOS-1234'),
        Field(label: 'Note', optional: true, controller: note, maxLines: 3),
        FilledButton.icon(
          key: const ValueKey('sheet-go'),
          onPressed: () {
            if (shipped.compareTo(f.today()) > 0) {
              setState(() => error = 'The ship date cannot be in the future.');
              return;
            }
            Navigator.pop(ctx, StageExtras(shippedOn: shipped, blNo: bl.text, note: note.text));
          },
          icon: const Icon(Icons.directions_boat_outlined, size: 18),
          label: const Text('Mark as shipped'),
        ),
      ]),
    ),
  );
}

/* ---------------------------------------------------------------- money */

class _MoneyCard extends ConsumerWidget {
  const _MoneyCard({required this.o});
  final Json o;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cur = o.s('currency', 'USD');
    final m = o.m('money');
    final due = f.toCents(m['due']);
    final depositDue = f.toCents(m['depositDue']);
    final payments = ref.watch(orderPaymentsProvider(o.s('id')));
    return SectionCard(
      title: 'Money',
      subtitle: '${o.i('depositPercent')}% deposit, ${(balanceTermsLabel[o.s('balanceTerms')] ?? o.s('balanceTerms')).toLowerCase()}',
      trailing: ToneBadge(customerPaymentLabel[m.s('status')] ?? m.s('status'), tone: due == 0 ? Tone.ok : Tone.neutral),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        StatGrid([
          StatTile(label: 'Total', value: f.money(m['total'], cur)),
          StatTile(
            label: 'Deposit',
            value: f.money(m['deposit'], cur),
            hint: f.toCents(m['deposit']) == 0 ? 'no deposit' : depositDue > 0 ? '${f.money(m['depositDue'], cur)} not in yet' : 'received',
            tone: depositDue > 0 ? Tone.warn : null,
          ),
          StatTile(label: 'Received', value: f.money(m['received'], cur), tone: f.toCents(m['received']) > 0 ? Tone.ok : null),
          StatTile(key: const ValueKey('still-due'), label: 'Still due', value: f.money(m['due'], cur), tone: due > 0 ? Tone.warn : Tone.ok),
        ]),
        Overline('Payments', padding: const EdgeInsets.fromLTRB(0, 4, 0, 6)),
        payments.when(
          loading: () => const Padding(padding: EdgeInsets.all(8), child: LinearProgressIndicator()),
          error: (e, _) => Text(e.toString(), style: context.t.bodySmall!.copyWith(color: context.c.bad)),
          data: (p) {
            final rows = p.l('payments');
            if (rows.isEmpty) return Text('Nothing received yet.', style: context.t.bodySmall);
            return Column(children: [
              for (final x in rows)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(
                          '${paymentKindLabel[x.s('kind')] ?? x.s('kind')} · ${f.date(x.sn('paidOn'))}',
                          style: context.t.bodyMedium!.copyWith(fontWeight: FontWeight.w600, decoration: x.mn('voided') != null ? TextDecoration.lineThrough : null),
                        ),
                        Text(
                          [
                            paymentMethodLabel[x.s('method')] ?? x.s('method'),
                            if (x.sn('reference') != null) x.s('reference'),
                            if (f.toCents(x['bankCharges']) > 0) 'bank charges ${f.money(x['bankCharges'], x.s('currency', cur))}',
                            if (x.mn('voided') != null) 'removed: ${x.m('voided').s('reason')}',
                          ].join(' · '),
                          style: context.t.bodySmall,
                        ),
                      ]),
                    ),
                    gap8,
                    MoneyText(x['amount'], x.s('currency', cur)),
                  ]),
                ),
            ]);
          },
        ),
      ]),
    );
  }
}

/* ---------------------------------------------------------------- details */

class _DetailsCard extends StatelessWidget {
  const _DetailsCard({required this.o});
  final Json o;
  @override
  Widget build(BuildContext context) {
    final incoterm = '${o.s('incoterm')} ${o.s('incotermPlace')}'.trim();
    return SectionCard(
      title: 'Details',
      child: kv([
        ('Ordered', f.date(o.sn('orderedOn'))),
        if (o.sn('shipBy') != null) ('Ship by', f.date(o.s('shipBy'))),
        ('Ready (factory)', o.sn('readyOn') == null ? 'Not known yet' : f.date(o.s('readyOn'))),
        ('Shipped', o.sn('shippedOn') == null ? 'Not yet' : f.date(o.s('shippedOn'))),
        ('B/L', o.s('blNo', '—')),
        ('Incoterm', incoterm.isEmpty ? '—' : incoterm),
        ('Handled by', o.m('inquiry').mn('assignee')?.s('name') ?? 'Not assigned'),
      ]),
    );
  }
}

/* ---------------------------------------------------------------- documents */

/// The PDF behind one of the order's documents (`documents[]`): the accepted quotation
/// (its revision) or the proforma, commercial invoice and packing list (the order).
({String kind, String id, String fileName}) documentPdf(Json order, Json doc) {
  final kind = doc.s('kind');
  final refNo = order.s('refNo');
  String numbered(String prefix) => refNo.replaceFirst(RegExp(r'^[A-Z]+-'), '$prefix-');
  return switch (kind) {
    'quotation' => (kind: 'revisions', id: doc.s('revisionId'), fileName: 'Quotation for $refNo.pdf'),
    'proforma' => (kind: 'proforma', id: order.s('id'), fileName: 'Proforma invoice ${numbered('PI')}.pdf'),
    'invoice' => (kind: 'invoice', id: order.s('id'), fileName: 'Commercial invoice ${numbered('INV')}.pdf'),
    'packing-list' => (kind: 'packing-list', id: order.s('id'), fileName: 'Packing list ${numbered('PL')}.pdf'),
    _ => (kind: kind, id: order.s('id'), fileName: '${doc.s('label', kind)} $refNo.pdf'),
  };
}

class _DocumentsCard extends StatelessWidget {
  const _DocumentsCard({required this.o});
  final Json o;
  @override
  Widget build(BuildContext context) {
    final docs = o.l('documents');
    return SectionCard(
      title: 'Documents',
      subtitle: 'Made from the order whenever you open them',
      padding: EdgeInsets.zero,
      child: CardList(children: [
        for (final d in docs)
          Builder(builder: (context) {
            final pdf = documentPdf(o, d);
            return RowTile(
              key: ValueKey('doc-${d.s('kind')}'),
              leading: Icon(Icons.picture_as_pdf_outlined, color: context.c.primary),
              title: d.s('label'),
              subtitle: Text(pdf.fileName.replaceAll(RegExp(r'\.pdf$'), '')),
              trailing: Icon(Icons.open_in_new_rounded, size: 18, color: context.c.muted),
              onTap: () => openPdf(context, kind: pdf.kind, id: pdf.id, fileName: pdf.fileName),
            );
          }),
      ]),
    );
  }
}

/* ---------------------------------------------------------------- history */

class _HistoryCard extends StatelessWidget {
  const _HistoryCard({required this.o});
  final Json o;
  @override
  Widget build(BuildContext context) {
    final rows = o.l('history').reversed.toList();
    if (rows.isEmpty) return const SizedBox.shrink();
    return SectionCard(
      title: 'History',
      padding: EdgeInsets.zero,
      child: CardList(children: [
        for (final h in rows)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Row(children: [
                Expanded(child: Text(historyTitle(h), style: context.t.bodyMedium!.copyWith(fontWeight: FontWeight.w600))),
                if (h.b('confirmed')) const ToneBadge('Went ahead', tone: Tone.warn),
              ]),
              Text('${h.m('by').s('name', 'Someone')} · ${f.dateTime(h.sn('at'))}', style: context.t.bodySmall),
              if (h.sn('note') != null) Padding(padding: const EdgeInsets.only(top: 3), child: Text(h.s('note'), style: context.t.bodySmall!.copyWith(color: context.c.text2))),
            ]),
          ),
      ]),
    );
  }
}

/// "Order confirmed", "Confirmed → In production", "Back to In production".
String historyTitle(Json h) {
  final from = h.sn('from');
  final to = h.s('to');
  final toLabel = orderStageLabel[to] ?? to;
  if (from == null) return to == 'confirmed' ? 'Order confirmed' : 'Started as $toLabel';
  if (orderStages.indexOf(to) < orderStages.indexOf(from)) return 'Back to $toLabel';
  return '${orderStageLabel[from] ?? from} → $toLabel';
}
