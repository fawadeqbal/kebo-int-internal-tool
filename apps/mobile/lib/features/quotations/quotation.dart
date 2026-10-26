import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/format.dart' as f;
import '../../core/json.dart';
import '../../core/labels.dart';
import '../../core/refresh.dart';
import '../../core/session.dart';
import '../../theme/colors.dart';
import '../../ui/docs.dart';
import '../../ui/kit.dart';

/// GET /api/inquiries/:id/quotation.
final quotationProvider = FutureProvider.autoDispose.family<Json, String>((ref, dealId) {
  ref.watch(dataVersionProvider);
  return ref.read(repoProvider).quotation(dealId);
});

/// A deal's quotation, read-mostly: every revision (R1, R2…) with its status and totals.
/// On the live revision: mark as sent, customer accepted (makes the order) or rejected.
class QuotationScreen extends ConsumerWidget {
  const QuotationScreen({super.key, required this.dealId});
  final String dealId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(quotationProvider(dealId));
    return Scaffold(
      appBar: AppBar(title: Text(data.value?.m('quotation').s('refNo', 'Quotation') ?? 'Quotation')),
      body: data.when(
        loading: () => const LoadingView(),
        error: (e, _) => ErrorState(e, onRetry: () => ref.invalidate(quotationProvider(dealId))),
        data: (q) {
          final revisions = q.l('revisions');
          return RefreshIndicator(
            onRefresh: () async => ref.read(dataVersionProvider.notifier).bump(),
            child: ListView(padding: pagePadding, children: [
              Text('${q.m('inquiry').s('refNo')} · ${stageLabel[q.m('inquiry').s('stage')] ?? ''}', style: context.t.bodySmall),
              gap12,
              const WebNote('Prices, terms and new revisions are edited on the web. Here you can follow the quotation and record the customer\'s answer.'),
              if (revisions.isEmpty) const EmptyState(icon: Icons.request_quote_outlined, title: 'No revisions yet'),
              for (var i = 0; i < revisions.length; i++) RevisionCard(dealId: dealId, r: revisions[i], expanded: i == 0, quoteRef: q.m('quotation').s('refNo', 'Quotation')),
            ]),
          );
        },
      ),
    );
  }
}

class RevisionCard extends ConsumerStatefulWidget {
  const RevisionCard({super.key, required this.dealId, required this.r, this.expanded = false, this.quoteRef = 'Quotation'});
  final String dealId;
  final Json r;
  final bool expanded;

  /// The quotation's number (Q-2026-0001), for the PDF's name.
  final String quoteRef;
  @override
  ConsumerState<RevisionCard> createState() => _RevisionCardState();
}

class _RevisionCardState extends ConsumerState<RevisionCard> {
  late bool _open = widget.expanded;

  Future<void> _move(String to) async {
    final r = widget.r;
    final (title, message, action) = switch (to) {
      'sent' => ('Mark R${r.i('number')} as sent?', 'The deal moves to Quoted and any older sent revision is replaced.', 'Mark as sent'),
      'accepted' => ('Customer accepted R${r.i('number')}?', 'This makes the order (Confirmed, waiting for the deposit). Acceptance is final; cancelling later needs a manager.', 'Customer accepted'),
      _ => ('Customer rejected R${r.i('number')}?', 'You can still make a new revision on the web.', 'Customer rejected'),
    };
    if (!await confirm(context, title: title, message: message, action: action, danger: to == 'rejected')) return;
    final repo = ref.read(repoProvider);
    await ref.mutate(() => repo.revisionStatus(r.s('id'), to));
    if (!mounted) return;
    if (to == 'accepted') {
      final deal = await repo.deal(widget.dealId);
      final order = deal.l('orders').firstOrNull;
      if (mounted && order != null) {
        toast(context, 'Order ${order.s('refNo')} created');
        context.pushReplacement('/orders/${order.s('id')}');
        return;
      }
    }
    if (mounted) toast(context, 'Saved: ${revisionStatusLabel[to]}');
  }

  @override
  Widget build(BuildContext context) {
    final r = widget.r;
    final cur = r.s('currency', 'USD');
    final status = r.s('status');
    final canManage = ref.watch(sessionProvider).can('quotations.manage');
    final costing = r.mn('costing');
    return SectionCard(
      title: 'R${r.i('number')}',
      subtitle: [
        if (r.sn('sentOn') != null) 'Sent ${f.date(r.s('sentOn'))}' else 'Not sent',
        'valid until ${f.date(r.s('validUntil'))}',
        if (r.sn('answeredOn') != null) 'answered ${f.date(r.s('answeredOn'))}',
      ].join(' · '),
      trailing: Row(mainAxisSize: MainAxisSize.min, children: [
        revisionStatusBadge(status),
        IconButton(
          tooltip: _open ? 'Hide lines' : 'Show lines',
          onPressed: () => setState(() => _open = !_open),
          icon: Icon(_open ? Icons.expand_less_rounded : Icons.expand_more_rounded),
        ),
      ]),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Text('Total', style: context.t.bodyMedium!.copyWith(color: context.c.muted)),
          const Spacer(),
          MoneyText(r['total'], cur, style: context.t.titleMedium),
        ]),
        gap4,
        Text(
          [
            '${r.s('incoterm')}${r.sn('incotermPlace') != null ? ' ${r.s('incotermPlace')}' : ''}',
            '${r.i('depositPercent')}% deposit',
            balanceTermsLabel[r.s('balanceTerms')] ?? r.s('balanceTerms'),
            if (r.sn('leadTime') != null) 'lead time ${r.s('leadTime')}',
          ].join(' · '),
          style: context.t.bodySmall,
        ),
        if (_open) ...[
          Divider(height: 24, color: context.c.line),
          QuoteLines(r: r),
          if (costing != null && costing['marginPercent'] != null) ...[
            gap12,
            Notice(
              'Internal: cost ${f.money(costing['cost'], cur)} · profit ${f.money(costing['profit'], cur)} · margin ${costing['marginPercent']}%${costing.i('uncostedLines') > 0 ? ' · ${costing.i('uncostedLines')} line(s) without a cost' : ''}',
              tone: Tone.money,
              icon: Icons.lock_outline_rounded,
            ),
          ],
          if (r.sn('terms') != null) ...[gap8, Overline('Terms', padding: EdgeInsets.zero), gap4, Text(r.s('terms'), style: context.t.bodySmall)],
        ],
        if (hasPdf(status)) ...[
          gap12,
          OutlinedButton.icon(
            key: ValueKey('pdf-${r.s('id')}'),
            onPressed: () => openPdf(context, kind: 'revisions', id: r.s('id'), fileName: 'Quotation ${widget.quoteRef}-R${r.i('number')}.pdf'),
            icon: const Icon(Icons.picture_as_pdf_outlined, size: 18),
            label: const Text('PDF to send or share'),
          ),
        ],
        if (canManage && status == 'draft') ...[
          gap16,
          BusyButton(label: 'Mark as sent', icon: Icons.send_rounded, onPressed: () => _move('sent')),
        ],
        if (canManage && status == 'sent' && r.b('canAnswer', true)) ...[
          gap16,
          BusyButton(label: 'Customer accepted', icon: Icons.check_circle_outline_rounded, onPressed: () => _move('accepted')),
          gap8,
          BusyButton(label: 'Customer rejected', icon: Icons.cancel_outlined, style: BusyStyle.outlined, onPressed: () => _move('rejected')),
        ],
      ]),
    );
  }
}

/// Revisions the customer has seen (sent or accepted) have a PDF to send again or share.
bool hasPdf(String status) => status == 'sent' || status == 'accepted';

/// Lines and totals as on the printed quotation.
class QuoteLines extends StatelessWidget {
  const QuoteLines({super.key, required this.r});
  final Json r;
  @override
  Widget build(BuildContext context) {
    final cur = r.s('currency', 'USD');
    final lines = r.l('lines');
    Widget total(String label, String value, {bool strong = false}) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 3),
          child: Row(children: [
            Text(label, style: strong ? context.t.titleSmall : context.t.bodyMedium!.copyWith(color: context.c.muted)),
            const Spacer(),
            Text(value, style: (strong ? context.t.titleSmall : context.t.bodyMedium)!.copyWith(fontFeatures: const [FontFeature.tabularFigures()])),
          ]),
        );
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      for (var i = 0; i < lines.length; i++) ...[
        if (i > 0) Divider(height: 20, color: context.c.line),
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(width: 22, child: Text('${i + 1}.', style: context.t.bodySmall)),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(lines[i].s('description').split('\n').first, style: context.t.bodyMedium!.copyWith(fontWeight: FontWeight.w600)),
              if (lines[i].s('type') != 'goods') Text(lineTypeLabel[lines[i].s('type')] ?? '', style: context.t.bodySmall),
              if (lines[i].sn('model') != null) Text('Model ${lines[i].s('model')}', style: context.t.bodySmall),
              const SizedBox(height: 2),
              Text('${f.qty(lines[i]['quantity'])} ${lines[i].s('unit')} × ${f.money(lines[i]['unitPrice'], cur)}', style: context.t.bodySmall),
            ]),
          ),
          gap8,
          MoneyText(lines[i]['lineTotal'], cur),
        ]),
      ],
      Divider(height: 24, color: context.c.lineStrong),
      total('Subtotal', f.money(r['subtotal'], cur)),
      if (f.toCents(r['discount']) > 0) total('Discount', '− ${f.money(r['discount'], cur)}'),
      // Tax is added on top; only revisions from before kept prices that included it.
      if (f.toCents(r['vatAmount']) > 0) total('Tax (${f.qty(r['vatRate'])}%)${r.b('pricesIncludeVat') ? ', included' : ''}', f.money(r['vatAmount'], cur)),
      total('Total', f.money(r['total'], cur), strong: true),
    ]);
  }
}
