import 'package:flutter/material.dart' hide Badge;

import '../core/api.dart';
import '../core/json.dart';
import '../core/scope.dart';
import '../ds/ds.dart';
import '../generated/enums.g.dart';
import '../generated/models.g.dart';
import 'inquiry_prices.dart';
import 'inquiry_quote.dart';
import 'links.dart';

/// What to do next on an inquiry, with the one primary button of the page.
class InquiryNext extends StatefulWidget {
  const InquiryNext(this.inquiry, {super.key, required this.title});
  final Inquiry inquiry;
  final String title;

  @override
  State<InquiryNext> createState() => _InquiryNextState();
}

class _InquiryNextState extends State<InquiryNext> {
  Json? latest; // the newest revision, when quoted
  bool asked = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!asked && widget.inquiry.quotation != null) {
      asked = true;
      loadRevisions(context.api, widget.inquiry.id).then((r) {
        if (mounted && r.isNotEmpty) setState(() => latest = r.first);
      }).catchError((_) {});
    }
  }

  Future<void> _answer(bool accepted) async {
    final r = latest!;
    final options = r.list('options', (m) => m);
    final done = await FormSheet.open(
      context,
      title: accepted ? 'Customer accepted R${r.integer('number')}' : 'Customer said no to R${r.integer('number')}',
      save: accepted ? 'Make the order' : 'Save the answer',
      intro: accepted
          ? (options.length == 1
              ? 'This makes the order from Option ${options.first.str('letter')}, ${fmtMoney(options.first.strOrNull('total'), r.strOrNull('currency'))}.'
              : 'This makes the order from the option they chose.')
          : 'The quotation is marked rejected. The inquiry stays open until you mark it lost.',
      initial: {
        'on': DateTime.now().toIso8601String().substring(0, 10),
        if (options.length == 1) 'optionId': options.first.str('id'),
      },
      groups: [
        FormGroup(fields: [
          if (accepted && options.length > 1)
            FieldDef('optionId', 'Which option', FieldKind.choice, required: true, options: {
              for (final o in options)
                o.str('id'): joinParts(['Option ${o.str('letter')}', fmtMoney(o.strOrNull('total'), r.strOrNull('currency'))]),
            }),
          const FieldDef('on', 'On', FieldKind.date, required: true),
          if (!accepted)
            const FieldDef('reason', 'Why', FieldKind.text, suggestions: ['Price too high', 'Customer bought elsewhere', 'No reply from the customer', 'Project cancelled']),
        ]),
      ],
      send: (api, body) => api.post('/api/revisions/${r.str('id')}/status', {'to': accepted ? 'accepted' : 'rejected', ...body}),
    );
    if (!done || !mounted) return;
    toast(context, accepted ? 'Order made' : 'Answer saved. Mark the inquiry as lost from ⋯ if it is over.');
    await RecordScope.reloadOf(context);
  }

  Future<void> _take() async {
    try {
      await context.api.post('/api/inquiries/${widget.inquiry.id}/assign', {'assigneeId': context.session.me?.id});
      if (mounted) await RecordScope.reloadOf(context);
    } on ApiException catch (e) {
      if (mounted) toast(context, e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final x = widget.inquiry;
    final can = context.can;
    String title;
    String? line;
    final buttons = <Widget>[];
    void primary(String label, VoidCallback onTap) => buttons.add(FilledButton(onPressed: onTap, child: Text(label)));
    void secondary(String label, VoidCallback onTap) => buttons.add(OutlinedButton(onPressed: onTap, child: Text(label)));

    final r = latest;
    final status = r?.strOrNull('status');
    switch (x.stage) {
      case 'won':
        final orders = (x.orders as List<dynamic>? ?? const []).whereType<Map<String, dynamic>>().toList();
        title = 'Won';
        line = orders.isEmpty ? null : 'Order ${orders.map((o) => o.str('refNo')).join(', ')}';
        if (orders.isNotEmpty) primary('Open the order', () => openLink(context, '/orders/${orders.first.str('id')}'));
      case 'lost':
        title = 'Lost';
        line = joinParts([LostReasonEnum.label(x.lostReason), x.lostNote]);
      default:
        if (x.onHold) {
          title = 'On hold';
          line = 'Resume it from ⋯ when the customer is ready.';
        } else if (x.assigneeId == null) {
          title = 'Next: someone takes it';
          line = 'Nobody handles this inquiry yet.';
          primary('Take it', _take);
        } else if (r != null && status == 'sent' && r['canAnswer'] == true && can('quotations.manage')) {
          title = 'Next: follow up the quotation';
          line = revisionLine(r);
          primary('Accepted', () => _answer(true));
          secondary('Rejected', () => _answer(false));
        } else if (r != null && status == 'draft') {
          title = 'Next: finish and send R${r.integer('number')}';
          line = 'The quotation is a draft. Prices and sending are on the web.';
        } else if (x.stage == 'quoted') {
          title = 'Next: wait for the answer';
          line = r == null ? null : revisionLine(r);
        } else {
          title = 'Next: get factory prices';
          line = 'Add each factory\'s offer as it comes in. The quotation is made on the web.';
          if (can('sourcing.manage')) {
            primary('Add a factory offer', () async {
              if (await openOfferSheet(context, x) && context.mounted) await RecordScope.reloadOf(context);
            });
          }
        }
    }
    final c = context.colors;
    return Container(
      padding: const EdgeInsets.all(Gap.lg),
      decoration: BoxDecoration(
        color: c.surface,
        borderRadius: BorderRadius.circular(Gap.radius),
        border: Border.all(color: buttons.isEmpty ? c.line : c.primary, width: buttons.isEmpty ? 1 : 1.5),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Semantics(header: true, child: Text(title, style: context.text.titleMedium)),
        if (line != null && line.isNotEmpty) ...[
          const SizedBox(height: Gap.xs),
          Text(line, style: context.text.bodySmall?.copyWith(color: c.text2)),
        ],
        if (buttons.isNotEmpty) ...[
          const SizedBox(height: Gap.md),
          Wrap(spacing: Gap.sm, runSpacing: Gap.sm, children: buttons),
        ],
      ]),
    );
  }
}

