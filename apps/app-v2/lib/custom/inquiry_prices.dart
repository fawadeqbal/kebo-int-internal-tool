import 'package:flutter/material.dart' hide Badge;

import '../core/api.dart';
import '../core/files.dart';
import '../core/json.dart';
import '../core/scope.dart';
import '../ds/ds.dart';
import '../generated/models.g.dart';
import 'inquiry_quote.dart';

/// "EXW Zhengzhou · CNY · +13% tax · 45 days · valid to 30 Nov".
String offerLine(Json q) {
  final rate = num.tryParse('${q['taxRate'] ?? 0}') ?? 0;
  return joinParts([
    joinParts([q.strOrNull('basis'), q.strOrNull('basisPlace')]).replaceAll(' · ', ' '),
    q.strOrNull('currency'),
    rate == 0 ? null : (q.boolean('taxIncluded') ? 'tax $rate% included' : '+$rate% tax'),
    q.strOrNull('leadTime'),
    if (q.date('validUntil') != null) 'valid to ${fmtDate(q.date('validUntil'))}',
  ]);
}

/// Factory prices on the inquiry page: each factory's offer, our cost in the
/// sales currency, which items it covers, and the cheapest one that covers all.
class InquiryPrices extends StatefulWidget {
  const InquiryPrices(this.inquiry, {super.key, required this.title});
  final Inquiry inquiry;
  final String title;

  @override
  State<InquiryPrices> createState() => _InquiryPricesState();
}

class _InquiryPricesState extends State<InquiryPrices> {
  Json? data;
  String? error;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (data == null && error == null) _load();
  }

  Future<void> _load() async {
    try {
      final j = await context.api.get('/api/inquiries/${widget.inquiry.id}/sourcing');
      if (mounted) setState(() => data = j);
    } on ApiException catch (e) {
      if (mounted) setState(() => error = e.message);
    }
  }

  Future<void> _add() async {
    if (await openOfferSheet(context, widget.inquiry) && mounted) {
      toast(context, 'Offer added');
      await RecordScope.reloadOf(context);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final d = data;
    final open = const ['new', 'sourcing', 'quoted'].contains(widget.inquiry.stage);
    final add = open ? TextButton.icon(onPressed: _add, icon: const Icon(Icons.add, size: 18), label: const Text('Add')) : null;
    if (d == null) {
      return SectionCard(
        title: widget.title,
        action: add,
        child: error == null
            ? const Padding(padding: EdgeInsets.all(Gap.lg), child: LoadingView())
            : Padding(padding: const EdgeInsets.symmetric(vertical: Gap.md), child: MessageBanner(error!, tone: Tone.bad)),
      );
    }
    final cur = d.strOrNull('currency');
    final quotes = d.list('quotes', (m) => m);
    final missingRates = (d['missingRates'] as List<dynamic>? ?? const []).join(', ');
    // The cheapest offer that prices every item.
    Json? best;
    for (final q in quotes.where((q) => coverageBadge(q).tone == Tone.ok)) {
      if (best == null || (num.tryParse(q.str('totalCost')) ?? 0) < (num.tryParse(best.str('totalCost')) ?? 0)) best = q;
    }
    return SectionCard(
      title: widget.title,
      count: quotes.isEmpty ? null : quotes.length,
      action: add,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (missingRates.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: Gap.sm),
            child: MessageBanner('No exchange rate for $missingRates in Settings: those costs are not counted.', tone: Tone.warn),
          ),
        if (quotes.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: Gap.md),
            child: Text('No factory prices yet.', style: context.text.bodySmall?.copyWith(color: c.muted)),
          ),
        for (final (i, q) in quotes.indexed)
          PhoneRow(
            RowData(
              title: q.at('factory.name'),
              sub: [offerLine(q)],
              value: fill('Our cost {}', fmtMoney(q.strOrNull('totalCost'), cur)),
              badge: identical(q, best) && quotes.length > 1 ? const Badge('Cheapest', Tone.ok) : coverageBadge(q),
              onTap: () => _detail(context, q, cur),
            ),
            divider: i < quotes.length - 1,
          ),
      ]),
    );
  }

  /// One offer's lines and files, read-only (changes are made on the web).
  void _detail(BuildContext context, Json q, String? cur) {
    final lines = q.list('lines', (m) => m);
    final files = q.list('files', (m) => m);
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      useRootNavigator: true,
      builder: (ctx) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.75,
        builder: (ctx, scroll) => ListView(
          controller: scroll,
          padding: const EdgeInsets.fromLTRB(Gap.lg, 0, Gap.lg, Gap.xl),
          children: [
            Semantics(header: true, child: Text(q.at('factory.name') ?? 'Offer', style: ctx.text.titleLarge)),
            Text(offerLine(q), style: ctx.text.bodySmall?.copyWith(color: ctx.colors.text2)),
            const SizedBox(height: Gap.md),
            SectionCard(
              title: 'Their prices',
              count: lines.length,
              child: Column(children: [
                for (final (i, l) in lines.indexed)
                  PhoneRow(
                    RowData(
                      title: joinParts([l.strOrNull('no'), l.strOrNull('description')]),
                      sub: [l.strOrNull('model'), joinParts([l.strOrNull('quantity'), l.strOrNull('unit')])],
                      value: fmtMoney(l.strOrNull('unitPrice'), q.strOrNull('currency')),
                    ),
                    divider: i < lines.length - 1,
                  ),
              ]),
            ),
            const SizedBox(height: Gap.md),
            SectionCard(
              title: 'Totals',
              child: Column(children: [
                KvRow('Their total', fmtMoney(q.strOrNull('factoryTotal'), q.strOrNull('currency')) ?? '—'),
                KvRow('Tax', fmtMoney(q.strOrNull('taxTotal'), q.strOrNull('currency')) ?? '—'),
                KvRow('Our cost', fmtMoney(q.strOrNull('totalCost'), cur) ?? '—'),
                if (q.strOrNull('advancePercent') != null) KvRow('Advance', '${q.str('advancePercent')}%'),
                if (q.strOrNull('paymentTerms') != null) KvRow('Payment terms', q.str('paymentTerms')),
              ]),
            ),
            if (files.isNotEmpty) ...[
              const SizedBox(height: Gap.md),
              SectionCard(
                title: 'Their quotation',
                child: Column(children: [
                  for (final f in files)
                    FileRow(
                      file: RemoteFile(path: '/api/files/${f.str('id')}', name: f.str('fileName'), type: f.strOrNull('mimeType'), size: f.integer('size')),
                      onTap: () => openFile(ctx,
                          RemoteFile(path: '/api/files/${f.str('id')}', name: f.str('fileName'), type: f.strOrNull('mimeType'), size: f.integer('size'))),
                    ),
                ]),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// The form for a factory's offer: its terms, then their price for each of the
/// customer's items (rows without a price are left out). True when saved.
Future<bool> openOfferSheet(BuildContext context, Inquiry inquiry) async {
  Json settings = const {};
  try {
    settings = (await context.api.get('/api/settings')).obj('sales', (s) => s) ?? const {};
  } on ApiException {
    // The company defaults are a convenience; the form works without them.
  }
  if (!context.mounted) return false;
  return FormSheet.open(
    context,
    title: 'Add a factory offer',
    save: 'Add the offer',
    initial: {
      ...FactoryQuoteFields.blank(),
      'receivedOn': DateTime.now().toIso8601String().substring(0, 10),
      'taxIncluded': settings['factoryTaxIncluded'] == true,
      'taxRate': '${settings['factoryTaxRate'] ?? 0}',
      'lines': [
        for (final i in inquiry.items)
          {'requestedItemId': i.id, 'description': i.description, 'quantity': i.quantity, 'unit': i.unit, 'unitPrice': ''},
      ],
    },
    groups: const [
      FormGroup(fields: [FactoryQuoteFields.factoryId, FactoryQuoteFields.receivedOn, FactoryQuoteFields.currency, FactoryQuoteFields.basis, FactoryQuoteFields.basisPlace]),
      FormGroup(fields: [FactoryQuoteFields.taxIncluded, FactoryQuoteFields.taxRate]),
      FormGroup(
        title: 'Their prices',
        list: ListDef('lines',
            itemLabel: 'Line',
            addLabel: 'Add a line they added',
            fields: [FactoryLineFields.description, FactoryLineFields.quantity, FactoryLineFields.unit, FactoryLineFields.unitPrice],
            blank: FactoryLineFields.blank),
      ),
      FormGroup(
        title: 'More details',
        folded: true,
        fields: [
          FactoryQuoteFields.validUntil,
          FactoryQuoteFields.leadTime,
          FactoryQuoteFields.advancePercent,
          FactoryQuoteFields.reference,
          FactoryQuoteFields.notes,
        ],
      ),
    ],
    send: (api, body) {
      // A line is sent only with a price: the factory may not quote every item.
      final lines = [
        for (final l in (body['lines'] as List<dynamic>).cast<Json>())
          if ('${l['unitPrice'] ?? ''}'.trim().isNotEmpty) l,
      ];
      return api.post('/api/inquiries/${inquiry.id}/factory-quotes', {...body, 'lines': lines});
    },
  );
}
