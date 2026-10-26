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
import '../shell/shell.dart';

/* ---------------------------------------------------------------- List */

class QuotationsScreen extends ConsumerStatefulWidget {
  const QuotationsScreen({super.key});
  @override
  ConsumerState<QuotationsScreen> createState() => _QuotationsScreenState();
}

class _QuotationsScreenState extends ConsumerState<QuotationsScreen> {
  String _q = '';
  String _status = '';
  String _sort = '';

  @override
  Widget build(BuildContext context) {
    final version = ref.watch(dataVersionProvider);
    final api = ref.read(apiProvider);
    final cur = ref.watch(metaProvider).value?.s('currency') ?? 'USD';
    final query = {'q': _q, 'status': _status, 'sort': _sort};
    return Scaffold(
      appBar: tabBar(context, 'Quotations', actions: [
        PopupMenuButton<String>(
          tooltip: 'Sort',
          icon: const Icon(Icons.sort_rounded),
          initialValue: _sort,
          onSelected: (v) => setState(() => _sort = v),
          itemBuilder: (_) => const [
            PopupMenuItem(value: '', child: Text('Newest first')),
            PopupMenuItem(value: 'expiry', child: Text('Valid-until date')),
            PopupMenuItem(value: 'value', child: Text('Highest value')),
          ],
        ),
      ]),
      body: PagedList(
        key: ValueKey('$version|$query'),
        load: (page) => api.get('/api/v1/quotations', query: {...query, 'page': page}),
        header: [
          SearchBox(hint: 'Search QUO no., customer, RFQ…', initial: _q, onChanged: (v) => setState(() => _q = v)),
          ChoiceChips<String>(
            value: _status,
            onChanged: (v) => setState(() => _status = v),
            options: [('', 'All'), ('expiring', 'Waiting for the customer'), for (final e in quotationStatusLabel.entries) (e.key, e.value)],
          ),
          gap12,
        ],
        empty: const EmptyState(icon: Icons.request_quote_outlined, title: 'No quotations', message: 'Quotations are made from an inquiry (Documents → Create quotation).'),
        itemBuilder: (context, r) {
          final late = r.s('status') == 'sent' && r.s('dueDate').compareTo(f.today()) < 0;
          return RowTile(
            title: r.s('companyName'),
            subtitle: Text('${r.s('refNo')} v${r.i('version')} · ${r.s('queryTitle')}\nValid until ${f.date(r.s('dueDate'))}${r.sn('preparedBy') != null ? ' · ${r.s('preparedBy')}' : ''}', maxLines: 3),
            trailing: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
              MoneyText(r['total'], r.s('currency', cur)),
              const SizedBox(height: 3),
              late ? const ToneBadge('Expired, no reply', tone: Tone.warn) : quotationStatusBadge(r.s('status')),
            ]),
            onTap: () => context.push('/quotations/${r.s('id')}'),
          );
        },
      ),
    );
  }
}

/* ---------------------------------------------------------------- Detail */

class QuotationDetailScreen extends ConsumerWidget {
  const QuotationDetailScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(getProvider('/api/v1/quotations/$id'));
    return data.when(
      loading: () => Scaffold(appBar: AppBar(), body: const LoadingView()),
      error: (e, _) => Scaffold(appBar: AppBar(), body: ErrorState(e, onRetry: () => ref.invalidate(getProvider('/api/v1/quotations/$id')))),
      data: (d) {
        final q = d.m('quotation');
        final cur = q.s('currency', 'USD');
        final can = d.m('can');
        final newer = d.m('newer');
        final superseded = d.b('superseded');
        final number = q.i('version') > 1 ? '${q.s('refNo')}-R${q.i('version') - 1}' : q.s('refNo');
        final late = q.s('status') == 'sent' && q.s('dueDate').compareTo(f.today()) < 0;
        final api = ref.read(apiProvider);
        return Scaffold(
          appBar: AppBar(
            title: Text(q.s('refNo'), style: mono13(context).copyWith(fontSize: 17, fontWeight: FontWeight.w600)),
            actions: [
              PdfButton(path: d.s('pdf'), fileName: '$number ${f.customerName(d.m('customer'))}'),
              if (can.b('edit')) IconButton(tooltip: 'Edit', icon: const Icon(Icons.edit_outlined), onPressed: () => context.push('/quotations/$id/edit')),
              if (can.b('revise') || can.b('delete'))
                PopupMenuButton<String>(
                  onSelected: (v) async {
                    try {
                      if (v == 'revise' && await confirm(context, title: 'Make a new version?', message: 'A new draft with the same lines. This one stays as the customer saw it.', action: 'New version')) {
                        final res = await ref.mutate(() => api.post('/api/v1/quotations/$id/revise'));
                        if (context.mounted) context.pushReplacement('/quotations/${res.s('id')}/edit');
                      }
                      if (v == 'delete' && context.mounted && await confirm(context, title: 'Delete this draft?', message: 'The draft quotation is removed.', action: 'Delete', danger: true)) {
                        await ref.mutate(() => api.delete('/api/v1/quotations/$id'));
                        if (context.mounted) {
                          toast(context, 'Draft quotation deleted');
                          context.pop();
                        }
                      }
                    } catch (e) {
                      if (context.mounted) toast(context, e.toString(), error: true);
                    }
                  },
                  itemBuilder: (_) => [
                    if (can.b('revise')) const PopupMenuItem(value: 'revise', child: Text('New version')),
                    if (can.b('delete')) const PopupMenuItem(value: 'delete', child: Text('Delete draft')),
                  ],
                ),
            ],
          ),
          body: ListView(padding: pagePadding, children: [
            Wrap(spacing: 6, children: [
              if (superseded) const ToneBadge('Superseded', tone: Tone.outline) else quotationStatusBadge(q.s('status')),
              ToneBadge('v${q.i('version')}', tone: Tone.outline),
              if (late && !superseded) const ToneBadge('Expired, no reply yet', tone: Tone.warn),
            ]),
            gap8,
            Text(f.money(q['total'], cur), style: context.t.headlineSmall),
            gap4,
            Text('${f.customerName(d.m('customer'))} · valid until ${f.date(q.s('dueDate'))}', style: context.t.bodySmall),
            gap16,
            if (superseded && newer.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Notice(
                  'Replaced by version ${newer.i('version')}. That one is sent, accepted and invoiced.',
                  action: TextButton(onPressed: () => context.pushReplacement('/quotations/${newer.s('id')}'), child: Text('Open v${newer.i('version')}')),
                ),
              ),
            if (can.l('transitions').isNotEmpty || can.b('invoice'))
              SectionCard(
                title: 'Next step',
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  if (can.b('invoice'))
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: FilledButton.icon(onPressed: () => context.push('/invoices/new?quotation=$id'), icon: const Icon(Icons.receipt_long_rounded, size: 18), label: const Text('Generate invoice')),
                    ),
                  for (final t in can.l('transitions'))
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: BusyButton(
                        label: t.s('label'),
                        style: t.s('to') == 'accepted' || t.s('to') == 'sent' ? BusyStyle.filled : BusyStyle.outlined,
                        onPressed: () async {
                          String sentOn = '';
                          if (t.s('to') == 'sent') {
                            final picked = await showDatePicker(context: context, initialDate: DateTime.now(), firstDate: DateTime(2020), lastDate: DateTime.now(), helpText: 'Sent to the customer on');
                            if (picked == null) return;
                            sentOn = f.isoDate(picked);
                          } else if (!await confirm(context, title: '${t.s('label')}?', message: 'The quotation becomes ${quotationStatusLabel[t.s('to')]}.', action: t.s('label'))) {
                            return;
                          }
                          await ref.mutate(() => api.post('/api/v1/quotations/$id/status', {'status': t.s('to'), 'submittedAt': sentOn}));
                          if (context.mounted) toast(context, 'Quotation status updated.');
                        },
                      ),
                    ),
                ]),
              ),
            SectionCard(
              title: 'Quotation details',
              child: kv([
                ('Date', f.date(q.sn('submittedAt') ?? q.s('createdAt'))),
                ('Valid until', f.date(q.s('dueDate'))),
                ('RFQ', d.m('query').s('refNo')),
                ('Prepared by', d.s('creatorName', '—')),
              ]),
            ),
            SectionCard(title: d.m('query').s('title'), subtitle: 'Lines', child: LinesView(items: d.l('items'), totals: q, currency: cur)),
            CostingCard(items: d.l('items'), discount: q['discount'], currency: cur, vat: f.Vat(rate: num.tryParse(q.s('taxRate')) ?? 0, included: q['pricesIncludeVat'] == true)),
            if (d.m('previous').isNotEmpty)
              SectionCard(
                title: 'Changes from v${d.m('previous').i('version')}',
                subtitle: 'Total ${f.money(d.m('previous')['total'], cur)} → ${f.money(q['total'], cur)}',
                child: RevisionChanges(changes: d.l('changes'), currency: cur),
              ),
            if (q.sn('terms') != null) SectionCard(title: 'Terms & conditions', child: Text(q.s('terms'), style: context.t.bodyMedium!.copyWith(color: context.c.text2))),
            if (q.sn('notes') != null) SectionCard(title: 'Internal notes', child: Text(q.s('notes'), style: context.t.bodyMedium!.copyWith(color: context.c.text2))),
            if (d.l('versions').length > 1)
              SectionCard(
                title: 'Versions',
                padding: EdgeInsets.zero,
                child: CardList(children: [
                  for (final v in d.l('versions'))
                    RowTile(
                      title: '${v.s('refNo')} v${v.i('version')}',
                      mono: true,
                      trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                        MoneyText(v['total'], cur),
                        gap8,
                        if (v.i('version') < d.i('latestVersion')) Text('Superseded', style: context.t.bodySmall) else quotationStatusBadge(v.s('status')),
                      ]),
                      onTap: v.s('id') == id ? null : () => context.pushReplacement('/quotations/${v.s('id')}'),
                    ),
                ]),
              ),
            if (d.l('invoices').isNotEmpty)
              SectionCard(
                title: 'Invoices',
                padding: EdgeInsets.zero,
                child: CardList(children: [
                  for (final i in d.l('invoices'))
                    RowTile(
                      title: i.s('invoiceNo'),
                      mono: true,
                      subtitle: Text('Due ${f.date(i.s('dueDate'))}'),
                      trailing: Row(mainAxisSize: MainAxisSize.min, children: [MoneyText(i['total'], cur), gap8, invoiceStatusBadge(invoiceDisplayStatus(i, f.today()))]),
                      onTap: () => context.push('/invoices/${i.s('id')}'),
                    ),
                ]),
              ),
            OutlinedButton.icon(onPressed: () => context.push('/inquiries/${d.m('query').s('id')}'), icon: const Icon(Icons.inbox_outlined, size: 18), label: Text('Open inquiry ${d.m('query').s('refNo')}')),
          ]),
        );
      },
    );
  }
}

/* ---------------------------------------------------------------- Form */

class QuotationFormScreen extends ConsumerStatefulWidget {
  const QuotationFormScreen({super.key, this.queryId, this.editId});
  final String? queryId;
  final String? editId;
  @override
  ConsumerState<QuotationFormScreen> createState() => _QuotationFormScreenState();
}

class _QuotationFormScreenState extends ConsumerState<QuotationFormScreen> {
  final _lines = <EditLine>[];
  final _discount = TextEditingController(text: '0');
  f.Vat _vat = const f.Vat();
  final _tax = TextEditingController();
  final _terms = TextEditingController();
  final _notes = TextEditingController();
  String _dueDate = '';
  String _submittedAt = '';
  String _subtitle = '';
  String _currency = 'USD';
  bool _loaded = false;
  bool _locked = false;
  Object? _loadError;
  ApiException? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final l in _lines) {
      l.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    final api = ref.read(apiProvider);
    try {
      Json init;
      if (widget.editId != null) {
        final d = await api.get('/api/v1/quotations/${widget.editId}');
        final q = d.m('quotation');
        _locked = q.s('status') != 'draft' || d.b('superseded');
        _currency = q.s('currency', 'USD');
        _vat = f.Vat.fromJson(d.m('vat'));
        init = {
          'items': [for (final it in d.l('items')) {...it, 'sourceId': it.s('queryItemId')}],
          'discount': (num.tryParse(q.s('discount')) ?? 0).toString(),
          'taxRate': (num.tryParse(q.s('taxRate')) ?? 0).toString(),
          'dueDate': q.s('dueDate'),
          'submittedAt': q.s('submittedAt'),
          'terms': q.s('terms'),
          'notes': q.s('notes'),
        };
        _subtitle = '${q.s('refNo')} v${q.i('version')} · ${f.customerName(d.m('customer'))}';
      } else {
        final d = await api.get('/api/v1/quotations/new', query: {'query': widget.queryId});
        init = d.m('initial');
        _subtitle = 'For ${f.customerName(d.m('customer'))} · ${d.m('query').s('refNo')}${d.i('version') > 1 ? ' · version ${d.i('version')}' : ''}';
        _currency = d.s('currency', 'USD');
        _vat = f.Vat.fromJson(d.m('vat'));
      }
      _lines.addAll(init.l('items').map(EditLine.fromJson));
      if (_lines.isEmpty) _lines.add(EditLine());
      _discount.text = init.s('discount', '0');
      _tax.text = init.s('taxRate', '${_vat.rate}');
      _dueDate = init.s('dueDate');
      _submittedAt = init.s('submittedAt');
      _terms.text = init.s('terms');
      _notes.text = init.s('notes');
      setState(() => _loaded = true);
    } catch (e) {
      setState(() => _loadError = e);
    }
  }

  Future<void> _save() async {
    setState(() => _error = null);
    final body = {
      'items': [for (final l in _lines) if (!l.isEmpty) l.toJson()],
      'discount': _discount.text,
      'taxRate': _tax.text,
      'dueDate': _dueDate,
      'submittedAt': _submittedAt,
      'terms': _terms.text,
      'notes': _notes.text,
    };
    final api = ref.read(apiProvider);
    try {
      if (widget.editId != null) {
        await ref.mutate(() => api.patch('/api/v1/quotations/${widget.editId}', body));
        if (mounted) {
          toast(context, 'Quotation saved');
          context.pop();
        }
      } else {
        final res = await ref.mutate(() => api.post('/api/v1/quotations', {...body, 'queryId': widget.queryId}));
        if (mounted) {
          toast(context, 'Draft quotation saved');
          context.pushReplacement('/quotations/${res.s('id')}');
        }
      }
    } on ApiException catch (e) {
      setState(() => _error = e);
      if (e.fieldErrors.isEmpty && mounted) toast(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final title = widget.editId == null ? 'New quotation' : 'Edit quotation';
    if (_loadError != null) return Scaffold(appBar: AppBar(title: Text(title)), body: ErrorState(_loadError!, onRetry: _load));
    if (!_loaded) return Scaffold(appBar: AppBar(title: Text(title)), body: const LoadingView());
    final e = _error;
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: ListView(padding: pagePadding, children: [
        Text(_subtitle, style: context.t.bodySmall),
        gap12,
        if (_locked) const Notice('Only drafts can be edited. To change a sent quotation, make a new version from its page.', tone: Tone.warn),
        if (e != null && e.fieldErrors.isNotEmpty) const Notice('Please fix the highlighted fields.', tone: Tone.bad),
        SectionCard(
          title: 'Lines & totals',
          child: LineItemsEditor(
            lines: _lines,
            discount: _discount,
            vat: _vat,
            taxRate: _tax,
            currency: _currency,
            sourceLabel: 'Requested by the customer',
            costing: ref.read(sessionProvider).can('sourcing.manage'),
            error: e?.field('items') ?? e?.field('discount') ?? e?.field('taxRate'),
          ),
        ),
        SectionCard(
          title: 'Validity & terms',
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            DateField(label: 'Valid until', value: _dueDate, error: e?.field('dueDate'), onChanged: (v) => setState(() => _dueDate = v)),
            Field(label: 'Terms & conditions', controller: _terms, optional: true, maxLines: 8, minLines: 3, error: e?.field('terms'), helper: 'Printed on the quotation'),
            Field(label: 'Internal notes', controller: _notes, optional: true, maxLines: 4, error: e?.field('notes'), helper: 'Only the team sees these'),
          ]),
        ),
        BusyButton(label: widget.editId == null ? 'Save as draft' : 'Save quotation', onPressed: _locked ? null : _save),
      ]),
    );
  }
}


/// What changed from the previous version: "Price 68,000 → 65,500", "Added: …".
class RevisionChanges extends StatelessWidget {
  const RevisionChanges({super.key, required this.changes, required this.currency});
  final List<Json> changes;
  final String currency;
  @override
  Widget build(BuildContext context) {
    if (changes.isEmpty) return Text('Same lines and prices; only the dates or terms may differ.', style: context.t.bodySmall);
    String qty(Object? v) => f.qty(v);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      for (final c in changes)
        Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${c.s('kind') == 'added' ? 'Added: ' : c.s('kind') == 'removed' ? 'Removed: ' : ''}${c.s('name')}', style: context.t.titleSmall),
            if (c.s('kind') == 'added') Text('${qty(c['quantity'])} ${c.s('unit')} × ${f.money(c['unitPrice'], currency)}', style: context.t.bodySmall),
            if (c.s('kind') == 'changed')
              Text(
                [
                  if (c['unitPrice'] is List) 'Price ${f.money((c['unitPrice'] as List)[0], currency)} → ${f.money((c['unitPrice'] as List)[1], currency)}',
                  if (c['quantity'] is List) 'Qty ${qty((c['quantity'] as List)[0])} → ${qty((c['quantity'] as List)[1])}',
                  if (c['unit'] is List) 'Unit ${(c['unit'] as List)[0]} → ${(c['unit'] as List)[1]}',
                  if (c['details'] == true) 'Description updated',
                ].join(' · '),
                style: context.t.bodySmall,
              ),
          ]),
        ),
    ]);
  }
}

/// Internal: what the lines cost us and the profit (from each line's cost). Nothing when no line has a cost.
class CostingCard extends StatelessWidget {
  const CostingCard({super.key, required this.items, required this.discount, required this.currency, this.vat = const f.Vat()});
  final List<Json> items;
  final Object? discount;
  final String currency;
  /// The quotation's VAT: when prices include it, profit is worked without it.
  final f.Vat vat;
  @override
  Widget build(BuildContext context) {
    var cost = 0, sales = 0, uncosted = 0;
    for (final it in items) {
      final q = num.tryParse(it.s('quantity')) ?? 0;
      if (it['unitCost'] == null) {
        uncosted++;
        continue;
      }
      cost += (f.toCents(it['unitCost']) * q).round();
      sales += (f.toCents(vat.net(num.tryParse(it.s('unitPrice')) ?? 0)) * q).round();
    }
    if (cost == 0) return const SizedBox.shrink();
    final profit = sales - cost - (f.toCents(vat.net(num.tryParse('$discount') ?? 0)));
    final pct = sales > 0 ? (profit / sales * 1000).round() / 10 : 0;
    return SectionCard(
      title: 'Costing',
      subtitle: 'Internal, not on the PDF',
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        KeyValues([
          ('Our cost (incl. VAT)', Text(f.cents(cost, currency), textAlign: TextAlign.right)),
          ('Sold for (before discount)', Text(f.cents(sales, currency), textAlign: TextAlign.right)),
          ('Profit', Text('${f.cents(profit, currency)} · $pct%', textAlign: TextAlign.right, style: TextStyle(fontWeight: FontWeight.w600, color: profit < 0 ? context.c.bad : context.c.ok))),
        ]),
        if (uncosted > 0) Padding(padding: const EdgeInsets.only(top: 6), child: Text('$uncosted line(s) without a cost (e.g. freight) are not counted.', style: context.t.bodySmall)),
        if (f.toCents(discount) > 0) Text('The discount is taken off the profit.', style: context.t.bodySmall),
      ]),
    );
  }
}
