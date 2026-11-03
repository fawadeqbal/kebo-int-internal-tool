import 'package:flutter/material.dart' hide Badge;

import '../core/api.dart';
import '../core/json.dart';
import '../core/scope.dart';
import '../ds/ds.dart';
import '../generated/models.g.dart';
import '../generated/screens/inquiry_form.g.dart';

/// How a customer does, all time: orders, sales, what they still owe (and how much is overdue),
/// paid on time, and the credit we hold for them. Each part shows only for people who may see it.
class CustomerOverview extends StatefulWidget {
  const CustomerOverview(this.customer, {super.key, required this.title});
  final Customer customer;
  final String title;

  @override
  State<CustomerOverview> createState() => _CustomerOverviewState();
}

class _CustomerOverviewState extends State<CustomerOverview> {
  Json? perf;
  List<Json> credit = const [];
  bool loaded = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!loaded) _load();
  }

  Future<void> _load() async {
    final api = context.api;
    final id = widget.customer.id;
    Json? p;
    var cr = const <Json>[];
    if (context.can('reports.view')) {
      try {
        final r = await api.get('/api/insights/facts/orders/groups', query: {'period': 'all', 'customerId': id});
        p = r.list('rows', (m) => m).firstOrNull?..['currency'] = r.str('currency')..['seeMoney'] = r.boolean('seeMoney');
      } on ApiException {
        // Insights off or not allowed: no performance.
      }
    }
    try {
      cr = (await api.get('/api/customers/$id/credit')).list('balances', (m) => m);
    } on ApiException {
      // not allowed: no credit line
    }
    if (mounted) {
      setState(() {
        perf = p;
        credit = cr;
        loaded = true;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = perf;
    if (!loaded || (p == null && credit.isEmpty)) return const SizedBox.shrink();
    final cur = p?.str('currency');
    final money = p?.boolean('seeMoney') ?? false;
    final overdue = num.tryParse(p?.str('overdue') ?? '') ?? 0;
    final paid = p?.objAt('paid');
    return SectionCard(
      title: widget.title,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: Gap.sm),
        child: StatGrid([
          if (p != null) StatTile('Orders', '${p.integer('orders')}', sub: p.strOrNull('lastOrderedOn') == null ? null : 'last ${fmtDate(p.date('lastOrderedOn'))}'),
          if (p != null && money) StatTile('Sales', fmtShort(p.str('sales'), cur) ?? '–', sub: p['margin'] == null ? null : '${p['margin']}% margin'),
          if (p != null && money)
            StatTile('Still owed', fmtShort(p.str('due'), cur) ?? '–',
                sub: overdue > 0 ? '${fmtShort(p.str('overdue'), cur)} overdue' : 'nothing overdue', tone: overdue > 0 ? Tone.bad : null),
          if (p != null && paid?['percent'] != null) StatTile('Paid on time', '${paid!['percent']}%', sub: '${paid['onTime']} of ${paid['inFull']} paid in full'),
          for (final b in credit) StatTile('Credit we hold', fmtMoney(b.str('amount'), b.str('currency')) ?? '–', sub: 'used on their next orders'),
        ]),
      ),
    );
  }
}

/// "+ New inquiry" on a customer: the inquiry form with the customer already chosen.
Future<bool> newInquiryFor(BuildContext context, Customer x) async {
  final saved = await InquiryFormSheet.create(context, prefill: {'customerId': x.id});
  if (saved && context.mounted) toast(context, 'Inquiry added for ${x.name}');
  return saved;
}
