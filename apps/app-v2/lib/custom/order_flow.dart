import 'package:flutter/material.dart' hide Badge;

import '../core/api.dart';
import '../core/json.dart';
import '../core/scope.dart';
import '../ds/ds.dart';
import '../generated/models.g.dart';
import 'delivery.dart';

const _tones = {'ok': Tone.ok, 'info': Tone.info, 'warn': Tone.warn, 'bad': Tone.bad, 'neutral': Tone.neutral};

/// Where the order stands: one row per stage (Payment, Factory order, Production, Shipping,
/// Delivery & SAT, Documents) with its word and a line of facts, read from what is stored.
/// Nothing is ticked. Money, goods, papers and files are changed in their own sections below;
/// Delivery & SAT opens its screen.
class OrderFlow extends StatefulWidget {
  const OrderFlow(this.order, {super.key, required this.title});
  final Order order;
  final String title;

  @override
  State<OrderFlow> createState() => _OrderFlowState();
}

class _OrderFlowState extends State<OrderFlow> {
  Json? sections;
  String? error;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (sections == null && error == null) _load();
  }

  Future<void> _load() async {
    try {
      final r = await context.api.get('/api/orders/${widget.order.id}/sections');
      if (mounted) setState(() => sections = r);
    } on ApiException catch (e) {
      if (mounted) setState(() => error = e.message);
    }
  }

  Future<void> _delivery() async {
    final saved = await openDelivery(context, widget.order);
    if (!saved || !mounted) return;
    toast(context, 'Saved');
    await _load();
    if (mounted) await RecordScope.reloadOf(context);
  }

  @override
  Widget build(BuildContext context) {
    final s = sections;
    if (s == null) {
      return SectionCard(
        title: widget.title,
        child: error == null
            ? const Padding(padding: EdgeInsets.all(Gap.lg), child: LoadingView())
            : Padding(padding: const EdgeInsets.symmetric(vertical: Gap.md), child: MessageBanner(error!, tone: Tone.bad)),
      );
    }
    final stands = s.list('stands', (m) => m);
    return SectionCard(
      title: widget.title,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        for (final (i, x) in stands.indexed)
          PhoneRow(
            RowData(
              title: x.str('label'),
              sub: [x.strOrNull('fact'), x.strOrNull('missing')],
              badge: Badge(x.str('word'), _tones[x.str('tone')] ?? Tone.neutral),
              onTap: x.str('stage') == 'delivery' ? _delivery : null,
            ),
            divider: i < stands.length - 1,
          ),
      ]),
    );
  }
}
