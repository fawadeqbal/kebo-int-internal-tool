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
import '../../ui/kit.dart';
import 'checklist.dart';

final orderProvider = FutureProvider.autoDispose.family<Json, String>((ref, id) {
  ref.watch(dataVersionProvider);
  return ref.read(repoProvider).order(id);
});

final _paymentsProvider = FutureProvider.autoDispose.family<Json, String>((ref, id) {
  ref.watch(dataVersionProvider);
  return ref.read(repoProvider).payments(id);
});

final _factoryOrdersProvider = FutureProvider.autoDispose.family<List<Json>, String>((ref, id) {
  ref.watch(dataVersionProvider);
  return ref.read(repoProvider).factoryOrders(id);
});

final _invoicesProvider = FutureProvider.autoDispose.family<List<Json>, String>((ref, id) {
  ref.watch(dataVersionProvider);
  return ref.read(repoProvider).invoices(id);
});

final _shipmentsProvider = FutureProvider.autoDispose.family<Json, String>((ref, id) {
  ref.watch(dataVersionProvider);
  return ref.read(repoProvider).shipments(id);
});

/// An order: its checklist with the next step, and read-only payments, factory orders, invoices and shipments.
class OrderDetailScreen extends ConsumerWidget {
  const OrderDetailScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(orderProvider(id));
    return data.when(
      loading: () => Scaffold(appBar: AppBar(), body: const LoadingView()),
      error: (e, _) => Scaffold(appBar: AppBar(), body: ErrorState(e, onRetry: () => ref.invalidate(orderProvider(id)))),
      data: (o) => DefaultTabController(
        length: 5,
        child: Scaffold(
          appBar: AppBar(
            title: Text(o.s('refNo'), style: mono13(context).copyWith(fontSize: 17, fontWeight: FontWeight.w600)),
            bottom: const TabBar(
              isScrollable: true,
              tabAlignment: TabAlignment.start,
              tabs: [Tab(text: 'Checklist'), Tab(text: 'Payments'), Tab(text: 'Factory'), Tab(text: 'Invoices'), Tab(text: 'Shipments')],
            ),
          ),
          body: TabBarView(children: [
            _ChecklistTab(id: id, o: o),
            _PaymentsTab(id: id),
            _FactoryTab(id: id),
            _InvoicesTab(id: id),
            _ShipmentsTab(id: id),
          ]),
        ),
      ),
    );
  }
}

Widget _refreshable(WidgetRef ref, List<Widget> children) => RefreshIndicator(
      onRefresh: () async => ref.read(dataVersionProvider.notifier).bump(),
      child: ListView(padding: pagePadding, children: children),
    );

/* ---------------------------------------------------------------- Checklist */

class _ChecklistTab extends ConsumerWidget {
  const _ChecklistTab({required this.id, required this.o});
  final String id;
  final Json o;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);
    final cur = o.s('currency', 'USD');
    final pay = o.m('customerPayments');
    final plan = o.m('plan');
    final next = plan.mn('next');
    return _refreshable(ref, [
      Wrap(spacing: 6, runSpacing: 6, children: [
        orderStageBadge(o.s('stage')),
        if (o.s('status') != 'open') ToneBadge(o.s('status') == 'closed' ? 'Closed' : 'Cancelled', tone: Tone.outline),
      ]),
      gap8,
      Text(o.m('customer').s('name'), style: context.t.titleLarge),
      gap4,
      InkWell(
        onTap: () => context.push('/deals/${o.m('inquiry').s('id')}'),
        child: Text('${o.m('inquiry').s('refNo')} · ${o.m('inquiry').s('title')}', style: context.t.bodySmall!.copyWith(color: context.c.primary)),
      ),
      gap16,
      if (next != null && o.s('status') == 'open')
        Notice(
          'Next: ${next.s('title')}${next.sn('due') != null ? ' — ${next.b('overdue') ? 'was due' : 'due'} ${f.date(next.s('due'))}' : ''}',
          tone: next.b('overdue') ? Tone.bad : Tone.info,
          icon: Icons.flag_outlined,
        ),
      StatGrid([
        StatTile(label: 'Order total', value: f.money(o['total'], cur), hint: '${o.i('depositPercent')}% deposit · ${o.s('incoterm')} ${o.s('incotermPlace')}'.trim()),
        StatTile(
          label: 'Still to receive',
          value: f.minor(pay['outstandingMinor'], cur),
          hint: customerPaymentLabel[pay.s('status')] ?? pay.s('status'),
          tone: pay.i('outstandingMinor') == 0 ? Tone.ok : null,
        ),
      ]),
      SectionCard(
        title: 'Checklist',
        subtitle: 'Payments, factory orders, invoices and shipments recorded on the web tick their steps by themselves.',
        child: OrderChecklist(
          plan: plan,
          canUpdate: session.can('milestones.update'),
          canOverride: session.can('milestones.override'),
          orderOpen: o.s('status') == 'open' || o.s('status') == 'closed',
          onAction: (step, action) => _run(context, ref, step, action),
        ),
      ),
      SectionCard(
        title: 'Dates and terms',
        child: kv([
          ('Ordered', f.date(o.sn('orderedOn'))),
          ('Ship by', f.date(o.sn('shipBy'))),
          ('Factory ready', f.date(o.sn('readyOn'))),
          ('Balance', balanceTermsLabel[o.s('balanceTerms')] ?? o.s('balanceTerms')),
          ('Handled by', o.m('inquiry').mn('assignee')?.s('name') ?? 'Not assigned'),
        ]),
      ),
      const WebNote('Recording payments, factory orders, invoices and shipments, and changing dates, is done on the web.'),
    ]);
  }

  Future<void> _run(BuildContext context, WidgetRef ref, Json step, String action, {String? note}) async {
    if (note == null && action != 'done') {
      final ok = action == 'undo'
          ? await confirm(context, title: 'Undo "${step.s('doneTitle', step.s('title'))}"?', message: 'The step goes back to the to-do list.', action: 'Undo')
          : await confirm(context, title: 'Skip "${step.s('title')}"?', message: 'Skipped steps count as settled. You can undo it later.', action: 'Skip');
      if (!ok) return;
    }
    try {
      await ref.mutate(() => ref.read(repoProvider).step(id, action, step.s('key'), note: note));
      if (context.mounted) {
        toast(context, switch (action) {
          'done' => '${step.s('doneTitle', 'Done')}.',
          'skip' => 'Skipped.',
          _ => 'Back to to-do.',
        });
      }
    } on ApiException catch (e) {
      if (!context.mounted) return;
      if (e.code == 'note_required') {
        final written = await askStepNote(context, e.message);
        if (written != null && context.mounted) await _run(context, ref, step, action, note: written);
        return;
      }
      if (e.gate || e.status == 409) {
        await showGate(context, e);
      } else {
        toast(context, e.message, error: true);
      }
    }
  }
}

/// A step refused by a rule: the reason in plain words, in a dialog that has to be read.
Future<void> showGate(BuildContext context, ApiException e) {
  return showDialog<void>(
    context: context,
    builder: (ctx) => AlertDialog(
      icon: Icon(Icons.lock_outline_rounded, color: ctx.c.warn),
      title: Text(gateTitle[e.code] ?? 'Not yet'),
      content: Text(e.message),
      actions: [FilledButton(onPressed: () => Navigator.pop(ctx), child: const Text('OK'))],
    ),
  );
}

/// The note a manager must give to skip a required step or go past a gate.
Future<String?> askStepNote(BuildContext context, String why) {
  final ctrl = TextEditingController();
  return showSheet<String>(
    context,
    title: 'Say why',
    subtitle: why,
    builder: (ctx) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Field(label: 'Note', controller: ctrl, maxLines: 3, autofocus: true),
      FilledButton(
        onPressed: () {
          if (ctrl.text.trim().isEmpty) return;
          Navigator.pop(ctx, ctrl.text.trim());
        },
        child: const Text('Save with this note'),
      ),
    ]),
  );
}

/* ---------------------------------------------------------------- Payments */

class _PaymentsTab extends ConsumerWidget {
  const _PaymentsTab({required this.id});
  final String id;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(_paymentsProvider(id));
    return data.when(
      loading: () => const LoadingView(),
      error: (e, _) => ErrorState(e, onRetry: () => ref.invalidate(_paymentsProvider(id))),
      data: (p) {
        final cur = p.s('currency', 'USD');
        final c = p.m('customer');
        final rows = p.l('payments');
        final inRows = rows.where((x) => x.s('direction') == 'in').toList();
        final outRows = rows.where((x) => x.s('direction') == 'out').toList();
        Widget row(Json x) => RowTile(
              title: '${paymentKindLabel[x.s('kind')] ?? x.s('kind')}${x.mn('factory') != null ? ' · ${x.m('factory').s('name')}' : ''}',
              subtitle: Text([
                f.date(x.sn('paidOn')),
                paymentMethodLabel[x.s('method')] ?? x.s('method'),
                if (x.sn('reference') != null) x.s('reference'),
                if (x.mn('factoryOrder') != null) x.m('factoryOrder').s('refNo'),
                if (f.toCents(x['bankCharges']) > 0) 'charges ${f.money(x['bankCharges'], x.s('currency'))}',
              ].join(' · ')),
              trailing: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                MoneyText(x['amount'], x.s('currency', cur)),
                if (x['voided'] != null && x['voided'] != false) const ToneBadge('Removed', tone: Tone.outline),
              ]),
            );
        return _refreshable(ref, [
          StatGrid([
            StatTile(label: 'Customer owes', value: f.money(c['due'], cur)),
            StatTile(label: 'Received', value: f.money(c['received'], cur), tone: Tone.ok),
            StatTile(label: 'Outstanding', value: f.money(c['outstanding'], cur), tone: f.toCents(c['outstanding']) > 0 ? Tone.warn : null),
            StatTile(label: 'Deposit still due', value: f.money(c['depositOutstanding'], cur)),
          ]),
          SectionCard(
            title: 'From the customer',
            padding: EdgeInsets.zero,
            child: inRows.isEmpty ? Padding(padding: const EdgeInsets.all(16), child: Text('Nothing received yet.', style: context.t.bodySmall)) : CardList(children: [for (final x in inRows) row(x)]),
          ),
          SectionCard(
            title: 'To factories',
            padding: EdgeInsets.zero,
            child: outRows.isEmpty ? Padding(padding: const EdgeInsets.all(16), child: Text('Nothing paid yet.', style: context.t.bodySmall)) : CardList(children: [for (final x in outRows) row(x)]),
          ),
          const WebNote('Payments are recorded on the web (accounts).'),
        ]);
      },
    );
  }
}

/* ---------------------------------------------------------------- Factory orders */

class _FactoryTab extends ConsumerWidget {
  const _FactoryTab({required this.id});
  final String id;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(_factoryOrdersProvider(id));
    return data.when(
      loading: () => const LoadingView(),
      error: (e, _) => ErrorState(e, onRetry: () => ref.invalidate(_factoryOrdersProvider(id))),
      data: (rows) => _refreshable(ref, [
        if (rows.isEmpty) const EmptyState(icon: Icons.factory_outlined, title: 'No factory orders yet', message: 'Purchase orders to the factories show here.'),
        for (final po in rows)
          SectionCard(
            title: '${po.s('refNo')} · ${po.m('factory').s('name')}',
            trailing: ToneBadge(factoryOrderStatusLabel[po.s('status')] ?? po.s('status'), tone: factoryOrderStatusTone[po.s('status')] ?? Tone.neutral, dot: true),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              for (final l in po.l('lines'))
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Expanded(child: Text('${l.s('description').split('\n').first}\n${f.qty(l['quantity'])} ${l.s('unit')} × ${f.money(l['unitPrice'], po.s('currency'))}', style: context.t.bodySmall)),
                    MoneyText(l['lineTotal'], po.s('currency')),
                  ]),
                ),
              Divider(height: 16, color: context.c.line),
              kv([
                ('Total', f.money(po['total'], po.s('currency'))),
                ('Paid', f.money(po['paid'], po.s('currency'))),
                ('Outstanding', f.money(po['outstanding'], po.s('currency'))),
                ('Ready on', f.date(po.sn('readyOn'))),
                if (po.sn('vatInvoiceNo') != null) ('VAT invoice', '${po.s('vatInvoiceNo')} · ${f.date(po.sn('vatInvoiceOn'))}'),
              ]),
            ]),
          ),
        const WebNote('Factory orders are made and sent on the web.'),
      ]),
    );
  }
}

/* ---------------------------------------------------------------- Invoices */

class _InvoicesTab extends ConsumerWidget {
  const _InvoicesTab({required this.id});
  final String id;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(_invoicesProvider(id));
    return data.when(
      loading: () => const LoadingView(),
      error: (e, _) => ErrorState(e, onRetry: () => ref.invalidate(_invoicesProvider(id))),
      data: (rows) => _refreshable(ref, [
        if (rows.isEmpty) const EmptyState(icon: Icons.receipt_long_outlined, title: 'No invoices yet', message: 'Proforma and commercial invoices show here.'),
        if (rows.isNotEmpty)
          Card(
            clipBehavior: Clip.antiAlias,
            child: CardList(children: [
              for (final inv in rows)
                RowTile(
                  mono: true,
                  title: inv.s('number', 'Draft'),
                  subtitle: Text([
                    invoiceTypeLabel[inv.s('type')] ?? inv.s('type'),
                    if (inv.sn('issueDate') != null) 'issued ${f.date(inv.s('issueDate'))}',
                    if (inv.sn('dueDate') != null) 'due ${f.date(inv.s('dueDate'))}',
                  ].join(' · ')),
                  trailing: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                    MoneyText(inv['total'], inv.s('currency', 'USD')),
                    const SizedBox(height: 2),
                    ToneBadge(invoiceStatusLabel[inv.s('status')] ?? inv.s('status'), tone: invoiceStatusTone[inv.s('status')] ?? Tone.neutral, dot: true),
                  ]),
                ),
            ]),
          ),
        gap12,
        const WebNote('Invoices are issued and printed on the web.'),
      ]),
    );
  }
}

/* ---------------------------------------------------------------- Shipments */

class _ShipmentsTab extends ConsumerWidget {
  const _ShipmentsTab({required this.id});
  final String id;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(_shipmentsProvider(id));
    return data.when(
      loading: () => const LoadingView(),
      error: (e, _) => ErrorState(e, onRetry: () => ref.invalidate(_shipmentsProvider(id))),
      data: (s) {
        final shipments = s.l('shipments');
        final left = s.l('remaining').where((r) => r.n('left') > 0).toList();
        return _refreshable(ref, [
          if (left.isNotEmpty)
            Notice('Still to ship: ${left.map((r) => '${f.qty(r['left'])} ${r.s('unit')} ${r.s('description').split('\n').first}').join(', ')}', tone: Tone.info),
          if (shipments.isEmpty) const EmptyState(icon: Icons.directions_boat_outlined, title: 'Nothing shipped yet', message: 'Packing lists and shipments show here.'),
          for (final sh in shipments)
            SectionCard(
              title: sh.s('refNo'),
              trailing: ToneBadge(shipmentStatusLabel[sh.s('status')] ?? sh.s('status'), tone: shipmentStatusTone[sh.s('status')] ?? Tone.neutral, dot: true),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                FigureBand([
                  ('Packages', '${sh.m('totals').i('packages')}'),
                  ('Gross', f.kg(sh.m('totals').n('grossKg'))),
                  ('Net', f.kg(sh.m('totals').n('netKg'))),
                  ('Volume', f.cbm(sh.m('totals').n('cbm'))),
                ], dark: false),
                gap12,
                kv([
                  if (sh.sn('blNo') != null) ('B/L', sh.s('blNo')),
                  if (sh.sn('containerNos') != null) ('Containers', sh.s('containerNos')),
                  if (sh.sn('portOfLoading') != null || sh.sn('portOfDischarge') != null) ('Route', '${sh.s('portOfLoading', '—')} → ${sh.s('portOfDischarge', '—')}'),
                  ('ETD / ETA', '${f.date(sh.sn('etd'))} / ${f.date(sh.sn('eta'))}'),
                  if (sh.sn('departedOn') != null) ('Departed', f.date(sh.s('departedOn'))),
                  ('Documents released', sh.sn('documentsReleasedOn') == null ? 'Not yet' : f.date(sh.s('documentsReleasedOn'))),
                ]),
                gap8,
                for (final l in sh.l('lines')) Text('${f.qty(l['quantity'])} ${l.s('unit')} · ${l.s('description').split('\n').first} · ${l.i('packages')} ${l.s('packageType')}', style: context.t.bodySmall),
              ]),
            ),
          const WebNote('Packing lists and shipments are made on the web.'),
        ]);
      },
    );
  }
}
