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
import '../../ui/line_items.dart';
import '../../ui/paged.dart';

/* ---------------------------------------------------------------- List */

class InvoicesScreen extends ConsumerStatefulWidget {
  const InvoicesScreen({super.key});
  @override
  ConsumerState<InvoicesScreen> createState() => _InvoicesScreenState();
}

class _InvoicesScreenState extends ConsumerState<InvoicesScreen> {
  String _q = '';
  String _status = 'outstanding';
  String _sort = '';

  @override
  Widget build(BuildContext context) {
    final version = ref.watch(dataVersionProvider);
    final api = ref.read(apiProvider);
    final cur = ref.watch(metaProvider).value?.s('currency') ?? 'USD';
    final query = {'q': _q, 'status': _status, 'sort': _sort};
    final today = f.today();
    return Scaffold(
      appBar: AppBar(title: const Text('Invoices'), actions: [
        PopupMenuButton<String>(
          tooltip: 'Sort',
          icon: const Icon(Icons.sort_rounded),
          initialValue: _sort,
          onSelected: (v) => setState(() => _sort = v),
          itemBuilder: (_) => const [
            PopupMenuItem(value: '', child: Text('Newest first')),
            PopupMenuItem(value: 'due', child: Text('Payment due date')),
            PopupMenuItem(value: 'balance', child: Text('Largest balance')),
          ],
        ),
      ]),
      body: PagedList(
        key: ValueKey('$version|$query'),
        load: (page) => api.get('/api/v1/invoices', query: {...query, 'page': page}),
        header: [
          SearchBox(hint: 'Search INV no., customer, RFQ…', initial: _q, onChanged: (v) => setState(() => _q = v)),
          ChoiceChips<String>(
            value: _status,
            onChanged: (v) => setState(() => _status = v),
            options: const [('outstanding', 'Outstanding'), ('overdue', 'Overdue'), ('unpaid', 'Unpaid'), ('partially_paid', 'Partially paid'), ('paid', 'Paid'), ('cancelled', 'Cancelled'), ('', 'All')],
          ),
          gap12,
        ],
        empty: const EmptyState(icon: Icons.receipt_long_outlined, title: 'No invoices here', message: 'Invoices are issued from an accepted quotation.'),
        itemBuilder: (context, r) {
          final status = invoiceDisplayStatus(r, today);
          final balance = f.toCents(r['total']) - f.toCents(r['amountPaid']);
          return RowTile(
            title: r.s('companyName'),
            subtitle: Text('${r.s('invoiceNo')} · ${r.s('queryRef')}\nIssued ${f.date(r.s('issueDate'))} · due ${f.date(r.s('dueDate'))}'),
            trailing: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
              Text(f.cents(r.s('status') == 'cancelled' ? f.toCents(r['total']) : balance, r.s('currency', cur)),
                  style: context.t.bodyMedium!.copyWith(fontWeight: FontWeight.w600, color: status == 'overdue' ? context.c.bad : null)),
              const SizedBox(height: 3),
              invoiceStatusBadge(status),
            ]),
            onTap: () => context.push('/invoices/${r.s('id')}'),
          );
        },
      ),
    );
  }
}

/* ---------------------------------------------------------------- Detail */

class InvoiceDetailScreen extends ConsumerWidget {
  const InvoiceDetailScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(getProvider('/api/v1/invoices/$id'));
    return data.when(
      loading: () => Scaffold(appBar: AppBar(), body: const LoadingView()),
      error: (e, _) => Scaffold(appBar: AppBar(), body: ErrorState(e, onRetry: () => ref.invalidate(getProvider('/api/v1/invoices/$id')))),
      data: (d) {
        final inv = d.m('invoice');
        final cur = inv.s('currency', 'USD');
        final can = d.m('can');
        final status = d.s('displayStatus');
        return Scaffold(
          appBar: AppBar(
            title: Text(inv.s('invoiceNo'), style: mono13(context).copyWith(fontSize: 17, fontWeight: FontWeight.w600)),
            actions: [
              PdfButton(path: d.s('pdf'), fileName: '${inv.s('invoiceNo')} ${f.customerName(d.m('customer'))}'),
              if (can.b('cancel'))
                PopupMenuButton<String>(
                  onSelected: (_) => _cancel(context, ref),
                  itemBuilder: (_) => const [PopupMenuItem(value: 'cancel', child: Text('Cancel invoice…'))],
                ),
            ],
          ),
          body: ListView(padding: pagePadding, children: [
            Align(alignment: Alignment.centerLeft, child: invoiceStatusBadge(status)),
            gap8,
            Text(f.money(inv['total'], cur), style: context.t.headlineSmall),
            gap4,
            Text('${f.customerName(d.m('customer'))} · from ${d.m('quotation').s('refNo')}', style: context.t.bodySmall),
            gap16,
            if (inv.s('status') == 'cancelled') Notice('Cancelled: ${inv.s('cancelReason')}', tone: Tone.neutral),
            SectionCard(
              title: 'Payment',
              subtitle: inv.s('status') == 'paid' ? 'Paid in full' : 'Due ${f.date(inv.s('dueDate'))}',
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                KeyValues([
                  ('Total', MoneyText(inv['total'], cur)),
                  ('Received', MoneyText(inv['amountPaid'], cur)),
                  ('Balance due', inv.s('status') == 'cancelled' ? const Text('—') : MoneyText(d['balance'], cur, bad: status == 'overdue')),
                ]),
                if (can.b('recordPayment')) ...[
                  gap12,
                  FilledButton.icon(onPressed: () => _payment(context, ref, d, cur), icon: const Icon(Icons.payments_outlined, size: 18), label: const Text('Record payment')),
                ],
              ]),
            ),
            if (d.l('payments').isNotEmpty)
              SectionCard(
                title: 'Payments received',
                padding: EdgeInsets.zero,
                child: CardList(children: [
                  for (final p in d.l('payments'))
                    RowTile(
                      title: f.money(p['amount'], cur),
                      subtitle: Text('${paymentMethodLabel[p.s('method')] ?? p.s('method')}${p.sn('reference') != null ? ' · ${p.s('reference')}' : ''} · by ${p.s('recordedBy')}'),
                      trailing: Text(f.date(p.s('paidAt')), style: context.t.bodySmall),
                    ),
                ]),
              ),
            SectionCard(
              title: 'Invoice details',
              child: kv([
                ('Invoice date', f.date(inv.s('issueDate'))),
                ('Payment due', f.date(inv.s('dueDate'))),
                ('Quotation', d.m('quotation').s('refNo')),
                ('RFQ', d.m('query').s('refNo')),
              ]),
            ),
            SectionCard(title: d.m('query').s('title'), subtitle: 'Lines', child: LinesView(items: d.l('items'), totals: inv, currency: cur)),
            if (inv.sn('notes') != null) SectionCard(title: 'Note on invoice', child: Text(inv.s('notes'), style: context.t.bodyMedium!.copyWith(color: context.c.text2))),
            if (inv.s('status') != 'cancelled')
              SectionCard(
                title: 'Packing list',
                padding: EdgeInsets.zero,
                trailing: can.b('packingList') ? TextButton(onPressed: () => context.push('/packing-lists/new?invoice=$id'), child: const Text('Create')) : null,
                child: d.l('packingLists').isEmpty
                    ? Padding(padding: const EdgeInsets.all(16), child: Text('Not made yet. Create it when the goods are packed: the lines come from this invoice.', style: context.t.bodySmall))
                    : CardList(children: [
                        for (final p in d.l('packingLists'))
                          RowTile(
                            mono: true,
                            title: p.s('plNo'),
                            subtitle: Text('${f.date(p.s('packDate'))} · ${p.i('packages')} pkgs · ${f.kg(num.tryParse(p.s('grossWeight')) ?? 0)} · ${f.cbm(num.tryParse(p.s('cbm')) ?? 0)}'),
                            onTap: () => context.push('/packing-lists/${p.s('id')}'),
                          ),
                      ]),
              ),
            OutlinedButton.icon(onPressed: () => context.push('/inquiries/${d.m('query').s('id')}'), icon: const Icon(Icons.inbox_outlined, size: 18), label: Text('Open inquiry ${d.m('query').s('refNo')}')),
          ]),
        );
      },
    );
  }

  Future<void> _payment(BuildContext context, WidgetRef ref, Json d, String cur) async {
    final amount = TextEditingController();
    final reference = TextEditingController();
    String paidAt = f.today();
    String method = 'bank_transfer';
    ApiException? error;
    await showSheet<void>(
      context,
      title: 'Record payment',
      subtitle: 'Balance due: ${f.money(d['balance'], cur)}',
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          if (error != null && error!.fieldErrors.isEmpty) Notice(error!.message, tone: Tone.bad),
          Field(label: 'Amount received ($cur)', controller: amount, keyboard: const TextInputType.numberWithOptions(decimal: true), autofocus: true, error: error?.field('amount')),
          DateField(label: 'Date', value: paidAt, error: error?.field('paidAt'), onChanged: (v) => set(() => paidAt = v)),
          SelectField<String>(label: 'Method', value: method, items: [for (final m in paymentMethodLabel.entries) (m.key, m.value)], onChanged: (v) => set(() => method = v ?? method)),
          Field(label: 'Reference', controller: reference, optional: true, helper: 'T/T reference, L/C number…', error: error?.field('reference')),
          BusyButton(
            label: 'Record payment',
            onPressed: () async {
              try {
                await ref.mutate(() => ref.read(apiProvider).post('/api/v1/invoices/$id/payments', {'amount': amount.text, 'paidAt': paidAt, 'method': method, 'reference': reference.text}));
                if (ctx.mounted) Navigator.pop(ctx);
                if (context.mounted) toast(context, 'Payment recorded.');
              } on ApiException catch (e) {
                set(() => error = e);
              }
            },
          ),
        ]),
      ),
    );
  }

  Future<void> _cancel(BuildContext context, WidgetRef ref) async {
    final reason = TextEditingController();
    await showSheet<void>(
      context,
      title: 'Cancel invoice',
      subtitle: 'Only possible before any payment. The invoice stays on record as cancelled.',
      builder: (ctx) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Field(label: 'Reason for cancelling', controller: reason, maxLines: 3, autofocus: true),
        BusyButton(
          label: 'Cancel invoice',
          style: BusyStyle.danger,
          onPressed: () async {
            await ref.mutate(() => ref.read(apiProvider).post('/api/v1/invoices/$id/cancel', {'reason': reason.text}));
            if (ctx.mounted) Navigator.pop(ctx);
            if (context.mounted) toast(context, 'Invoice cancelled');
          },
        ),
      ]),
    );
  }
}

/* ---------------------------------------------------------------- Form */

class InvoiceFormScreen extends ConsumerStatefulWidget {
  const InvoiceFormScreen({super.key, required this.quotationId});
  final String quotationId;
  @override
  ConsumerState<InvoiceFormScreen> createState() => _InvoiceFormScreenState();
}

class _InvoiceFormScreenState extends ConsumerState<InvoiceFormScreen> {
  List<Json> _items = [];
  Json _totals = {};
  final _notes = TextEditingController();
  String _issueDate = '';
  String _dueDate = '';
  String _subtitle = '';
  String _currency = 'USD';
  bool _loaded = false;
  Object? _loadError;
  ApiException? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = await ref.read(apiProvider).get('/api/v1/invoices/new', query: {'quotation': widget.quotationId});
      final init = d.m('initial');
      _items = d.l('items');
      _totals = d.m('totals');
      _issueDate = init.s('issueDate');
      _dueDate = init.s('dueDate');
      _currency = d.s('currency', 'USD');
      _subtitle = 'From ${d.m('quotation').s('refNo')} (v${d.m('quotation').i('version')}) · ${f.customerName(d.m('customer'))} · ${d.m('query').s('refNo')}';
      setState(() => _loaded = true);
    } catch (e) {
      setState(() => _loadError = e);
    }
  }

  Future<void> _save() async {
    setState(() => _error = null);
    try {
      final res = await ref.mutate(() => ref.read(apiProvider).post('/api/v1/invoices', {
            'quotationId': widget.quotationId,
            'issueDate': _issueDate,
            'dueDate': _dueDate,
            'notes': _notes.text,
          }));
      if (mounted) {
        toast(context, 'Invoice issued');
        context.pushReplacement('/invoices/${res.s('id')}');
      }
    } on ApiException catch (e) {
      setState(() => _error = e);
      if (e.fieldErrors.isEmpty && mounted) toast(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    const title = 'Generate invoice';
    if (_loadError != null) return Scaffold(appBar: AppBar(title: const Text(title)), body: ErrorState(_loadError!, onRetry: _load));
    if (!_loaded) return Scaffold(appBar: AppBar(title: const Text(title)), body: const LoadingView());
    final e = _error;
    return Scaffold(
      appBar: AppBar(title: const Text(title)),
      body: ListView(padding: pagePadding, children: [
        Text(_subtitle, style: context.t.bodySmall),
        gap12,
        if (e != null && e.fieldErrors.isNotEmpty) const Notice('Please fix the highlighted fields.', tone: Tone.bad),
        SectionCard(
          title: 'What is invoiced',
          subtitle: 'Exactly the accepted quotation. To change anything, make a new quotation version and have it accepted.',
          child: LinesView(items: _items, totals: _totals, currency: _currency),
        ),
        SectionCard(
          title: 'Dates',
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            DateField(label: 'Invoice date', value: _issueDate, error: e?.field('issueDate'), onChanged: (v) => setState(() => _issueDate = v)),
            DateField(label: 'Payment due', value: _dueDate, error: e?.field('dueDate'), onChanged: (v) => setState(() => _dueDate = v)),
            Field(label: 'Note on invoice', controller: _notes, optional: true, maxLines: 3, helper: 'e.g. customer PO number', error: e?.field('notes')),
          ]),
        ),
        BusyButton(label: 'Issue invoice', onPressed: _save),
      ]),
    );
  }
}
