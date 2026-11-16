import 'package:flutter/material.dart';

import '../../../core/format.dart';
import '../../../core/json.dart';
import '../../../design/design.dart';
import '../domain/sales_terms.dart';

/// The latest quotation revision in two views of one document: **Customer** (what they
/// see: lines, total, terms) and **Internal** (adds the factory, cost, profit and margin,
/// each marked Internal). The internal view only exists for people who may see costs.
class QuotationCard extends StatefulWidget {
  const QuotationCard({super.key, required this.refNo, required this.revision, required this.revisionCount});
  final String? refNo;
  final Json revision;
  final int revisionCount;

  @override
  State<QuotationCard> createState() => _QuotationCardState();
}

class _QuotationCardState extends State<QuotationCard> {
  bool _internal = true;

  @override
  Widget build(BuildContext context) {
    final r = widget.revision;
    final c = context.k;
    final cur = r.strOrNull('currency');
    final options = r.list('options', (m) => m);
    final seesCosts = options.any((o) => o['costing'] != null);
    final internal = seesCosts && _internal;
    final terms = [
      if (r.strOrNull('incoterm') != null)
        '${r.str('incoterm')}${r.strOrNull('incotermPlace') == null ? '' : ' ${r.str('incotermPlace')}'}',
      if (r['depositPercent'] is num && (r['depositPercent'] as num) > 0)
        '${(r['depositPercent'] as num).round()}% advance',
    ].join(' · ');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (seesCosts) ...[
          KSegmented<bool>(
            value: _internal,
            onChanged: (v) => setState(() => _internal = v),
            segments: const [(true, 'Internal'), (false, 'Customer')],
          ),
          const SizedBox(height: KSpace.s2),
          Text(
            internal
                ? 'Costs and margin are marked Internal. They never go to the customer.'
                : 'Exactly what the customer receives.',
            style: KType.footnote.copyWith(color: c.inkMuted),
          ),
          const SizedBox(height: KSpace.s3),
        ],
        KCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      '${widget.refNo ?? 'Quotation'} · rev ${r.integer('number')}',
                      style: KType.title3.copyWith(color: c.ink, fontFeatures: const [FontFeature.tabularFigures()]),
                    ),
                  ),
                  RevisionStatus.badge(r.strOrNull('status')),
                ],
              ),
              if (widget.revisionCount > 1)
                Text(
                  '${widget.revisionCount} revisions; this is the latest.',
                  style: KType.footnote.copyWith(color: c.inkMuted),
                ),
              const SizedBox(height: KSpace.s2),
              KDetail(
                'Total${r.str('figuresOf').isEmpty ? '' : ' (${r.str('figuresOf')})'}',
                fmtMoney(r.strOrNull('total'), cur),
                emphasis: true,
              ),
              Row(
                children: [
                  Expanded(child: KDetail('Valid until', fmtDate(DateTime.tryParse(r.str('validUntil'))))),
                  Expanded(child: KDetail('Lead time', r.strOrNull('leadTime'))),
                ],
              ),
              KDetail('Price basis and advance', terms),
              KDetail('Payment terms', r.strOrNull('paymentTerms')),
              if (r.strOrNull('sentOn') != null) KDetail('Sent', fmtDate(DateTime.tryParse(r.str('sentOn')))),
              for (final o in options) ...[
                const Divider(height: KSpace.s6),
                _Option(o: o, currency: cur, internal: internal, many: options.length > 1),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _Option extends StatelessWidget {
  const _Option({required this.o, required this.currency, required this.internal, required this.many});
  final Json o;
  final String? currency;
  final bool internal, many;

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    final lines = o.list('lines', (m) => m);
    final costing = o.objAt('costing');
    final margin = costing?['marginPercent'];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (many) Text('Option ${o.str('letter')}', style: KType.label.copyWith(color: c.ink)),
        for (final l in lines)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: KSpace.s1),
            child: MergeSemantics(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 32,
                    child: Text(l.str('no'), style: KType.footnote.copyWith(color: c.inkMuted)),
                  ),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(l.str('description'), style: KType.callout.copyWith(color: c.ink)),
                        Text(
                          '${l.str('quantity')} ${l.str('unit')} × ${fmtMoney(l.strOrNull('unitPrice'), null)}'
                          '${internal && l.strOrNull('unitCost') != null ? '  ·  cost ${fmtMoney(l.strOrNull('unitCost'), null)}' : ''}',
                          style: KType.footnote.copyWith(
                            color: c.inkMuted,
                            fontFeatures: const [FontFeature.tabularFigures()],
                          ),
                        ),
                      ],
                    ),
                  ),
                  Text(
                    fmtMoney(l.strOrNull('lineTotal'), null) ?? '',
                    style: KType.callout.copyWith(color: c.ink, fontFeatures: const [FontFeature.tabularFigures()]),
                  ),
                ],
              ),
            ),
          ),
        if (o.str('discount') != '0.00') KDetail('Discount', fmtMoney(o.strOrNull('discount'), currency)),
        if (internal && costing != null) ...[
          const SizedBox(height: KSpace.s2),
          Container(
            padding: const EdgeInsets.all(KSpace.s3),
            decoration: BoxDecoration(color: c.surfaceSunken, borderRadius: BorderRadius.circular(KRadius.md)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    const KBadge.internal(),
                    const SizedBox(width: KSpace.s2),
                    Expanded(
                      child: Text(
                        o.at('factory.name') ?? 'Priced from the customer\'s items',
                        style: KType.footnote.copyWith(color: c.inkMuted),
                      ),
                    ),
                  ],
                ),
                Row(
                  children: [
                    Expanded(child: KDetail('Cost', fmtMoney(costing.strOrNull('cost'), currency))),
                    Expanded(child: KDetail('Profit', fmtMoney(costing.strOrNull('profit'), currency))),
                  ],
                ),
                KDetail(
                  'Margin',
                  margin is num ? '${margin.toStringAsFixed(1)}%' : null,
                  trailing: margin is num && margin < 10 ? const KBadge('Low', tone: KTone.warning) : null,
                ),
                if ((costing['uncostedLines'] is num) && (costing['uncostedLines'] as num) > 0)
                  Text(
                    '${costing['uncostedLines']} line(s) have no cost yet, so the margin is incomplete.',
                    style: KType.footnote.copyWith(color: c.warning),
                  ),
              ],
            ),
          ),
        ],
      ],
    );
  }
}
