import 'package:flutter/material.dart' hide Badge;

import '../core/api.dart';
import '../core/files.dart';
import '../core/json.dart';
import '../core/scope.dart';
import '../ds/ds.dart';
import '../generated/enums.g.dart';
import '../generated/models.g.dart';

/// The quotation of an inquiry (`GET /inquiries/:id/quotation`), newest revision first.
Future<List<Json>> loadRevisions(Api api, String inquiryId) async =>
    (await api.get('/api/inquiries/$inquiryId/quotation')).list('revisions', (m) => m)
      ..sort((a, b) => b.integer('number').compareTo(a.integer('number')));

/// "R2 · sent 30 Oct · valid to 6 Nov".
String revisionLine(Json r) => joinParts([
      'R${r.integer('number')}',
      if (r.date('sentOn') != null) 'sent ${fmtDate(r.date('sentOn'))}' else RevisionStatusEnum.label(r.strOrNull('status'))?.toLowerCase(),
      if (r.date('validUntil') != null) 'valid to ${fmtDate(r.date('validUntil'))}',
    ]);

/// The PDF of a revision: customer copy, and the internal copy as a second view.
void openRevisionPdf(BuildContext context, Json r, String quoteNo, {bool internal = false}) {
  final id = r.str('id');
  final name = 'Quotation $quoteNo-R${r.integer('number')}';
  final customer = RemoteFile(path: '/pdf/revisions/$id', name: '$name.pdf', type: 'application/pdf', note: revisionLine(r));
  final copy = RemoteFile(
      path: '/pdf/revisions/$id?copy=internal', name: '$name (internal).pdf', type: 'application/pdf', note: 'Internal copy', internal: true);
  openFile(context, internal ? copy : customer, variants: internal ? const [] : [FileVariant('Internal copy', copy)]);
}

/// The quotation on the inquiry page: the latest revision's options with their totals,
/// its PDF and internal copy, and the earlier revisions. Prices are made on the web.
class InquiryQuote extends StatefulWidget {
  const InquiryQuote(this.inquiry, {super.key, required this.title});
  final Inquiry inquiry;
  final String title;

  @override
  State<InquiryQuote> createState() => _InquiryQuoteState();
}

class _InquiryQuoteState extends State<InquiryQuote> {
  List<Json>? revisions;
  String? error;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (revisions == null && error == null) _load();
  }

  Future<void> _load() async {
    try {
      final r = await loadRevisions(context.api, widget.inquiry.id);
      if (mounted) setState(() => revisions = r);
    } on ApiException catch (e) {
      // No quotation yet answers 404: that is not a problem to show.
      if (mounted) setState(() => e.status == 404 ? revisions = const [] : error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final list = revisions;
    final quoteNo = widget.inquiry.quotation?.refNo ?? '';
    final Widget body;
    if (error != null) {
      body = Padding(padding: const EdgeInsets.symmetric(vertical: Gap.md), child: MessageBanner(error!, tone: Tone.bad));
    } else if (list == null) {
      body = const Padding(padding: EdgeInsets.all(Gap.lg), child: LoadingView());
    } else if (list.isEmpty) {
      body = Padding(
        padding: const EdgeInsets.symmetric(vertical: Gap.md),
        child: Text('No quotation yet. It is made on the web from the factory prices.', style: context.text.bodySmall?.copyWith(color: c.muted)),
      );
    } else {
      final latest = list.first;
      final options = latest.list('options', (m) => m);
      body = Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        PhoneRow(RowData(
          title: revisionLine(latest),
          sub: [
            joinParts([latest.strOrNull('incoterm'), latest.strOrNull('incotermPlace')]),
            if (latest.integer('depositPercent') > 0) '${latest.integer('depositPercent')}% deposit',
          ],
          badge: RevisionStatusEnum.badge(latest.strOrNull('status')),
        )),
        for (final (i, o) in options.indexed)
          PhoneRow(
            RowData(
              title: joinParts(['Option ${o.str('letter')}', o.at('factory.name')]),
              sub: [
                fmtMoney(o.strOrNull('total'), latest.strOrNull('currency')),
                if (o.at('costing.marginPercent') != null) 'margin ${o.at('costing.marginPercent')}%',
                o.strOrNull('leadTime'),
              ],
              badge: coverageBadge(o),
            ),
            divider: i < options.length - 1,
          ),
        Wrap(spacing: Gap.sm, children: [
          TextButton.icon(
            onPressed: () => openRevisionPdf(context, latest, quoteNo),
            icon: const Icon(Icons.picture_as_pdf_outlined, size: 18),
            label: const Text('PDF'),
          ),
          TextButton.icon(
            onPressed: () => openRevisionPdf(context, latest, quoteNo, internal: true),
            icon: const Icon(Icons.lock_outline, size: 16),
            label: const Text('Internal copy'),
          ),
        ]),
        if (list.length > 1) ...[
          Divider(height: 1, color: c.line),
          for (final (i, r) in list.skip(1).indexed)
            PhoneRow(
              RowData(
                title: revisionLine(r),
                value: fmtMoney(r.strOrNull('total'), r.strOrNull('currency')),
                onTap: () => openRevisionPdf(context, r, quoteNo),
              ),
              divider: i < list.length - 2,
            ),
        ],
      ]);
    }
    return SectionCard(title: quoteNo.isEmpty ? widget.title : '${widget.title} · $quoteNo', child: body);
  }
}

/// "Covers all" or "Misses 2": which of the customer's items an offer or option prices.
Badge coverageBadge(Json o) {
  final missing = (o['coverage'] as Map<String, dynamic>?)?['missing'];
  final n = missing is List ? missing.length : 0;
  return n == 0 ? const Badge('Covers all', Tone.ok) : Badge('Misses $n', Tone.warn);
}
