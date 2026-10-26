import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/format.dart' as f;
import '../../core/json.dart';
import '../../core/labels.dart';
import '../../core/refresh.dart';
import '../../core/session.dart';
import '../../theme/colors.dart';
import '../../ui/kit.dart';
import '../shell/shell.dart';

/// Late first, then by when the need is due (orders that need nothing last).
List<Json> byNeed(List<Json> rows) {
  int late(Json o) => (o.mn('needs')?.b('late') ?? false) ? 0 : 1;
  String due(Json o) => o.mn('needs')?.s('due', '9999') ?? '9999';
  return [...rows]..sort((a, b) => late(a) != late(b) ? late(a) - late(b) : due(a).compareTo(due(b)));
}

/// Orders by `<status>|mine` or `<status>|all`: open (Confirmed, In production, Shipped) or closed (Done).
final ordersProvider = FutureProvider.autoDispose.family<List<Json>, String>((ref, filter) async {
  ref.watch(dataVersionProvider);
  final parts = filter.split('|');
  final rows = await ref.read(repoProvider).orders(status: parts[0], mine: parts[1] == 'mine');
  return byNeed(rows);
});

/// Orders (SO-…) by stage: Confirmed, In production, Shipped, Done — each with what it needs now.
class OrdersScreen extends ConsumerStatefulWidget {
  const OrdersScreen({super.key});
  @override
  ConsumerState<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends ConsumerState<OrdersScreen> {
  String _stage = 'confirmed';
  late bool _mine = !ref.read(sessionProvider).isManager;

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionProvider);
    final who = _mine ? 'mine' : 'all';
    final open = ref.watch(ordersProvider('open|$who'));
    final closed = ref.watch(ordersProvider('closed|$who'));
    final source = _stage == 'done' ? closed : open;
    int count(String s) => (s == 'done' ? closed : open).value?.where((o) => o.s('stage') == s).length ?? 0;
    String label(String s) {
      final loaded = (s == 'done' ? closed : open).hasValue;
      return loaded ? '${orderStageLabel[s]} ${count(s)}' : orderStageLabel[s]!;
    }

    return Scaffold(
      appBar: tabBar(context, 'Orders'),
      body: RefreshIndicator(
        onRefresh: () async => ref.read(dataVersionProvider.notifier).bump(),
        child: ListView(
          padding: const EdgeInsets.only(top: 8, bottom: 96),
          children: [
            ChoiceChips<String>(
              value: _stage,
              onChanged: (v) => setState(() => _stage = v),
              options: [for (final s in orderStages) (s, label(s))],
            ),
            if (session.isManager)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: ChoiceChips<bool>(value: _mine, onChanged: (v) => setState(() => _mine = v), options: const [(false, 'Everyone'), (true, 'Mine')]),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 8),
              child: Text(orderStageHint[_stage] ?? '', style: context.t.bodySmall),
            ),
            ...source.when(
              loading: () => [const LoadingView()],
              error: (e, _) => [ErrorState(e, onRetry: () => ref.invalidate(ordersProvider('${_stage == 'done' ? 'closed' : 'open'}|$who')))],
              data: (all) {
                final rows = all.where((o) => o.s('stage') == _stage).toList();
                if (rows.isEmpty) {
                  return [
                    EmptyState(
                      icon: Icons.local_shipping_outlined,
                      title: 'No orders ${orderStageLabel[_stage]!.toLowerCase()}',
                      message: 'An order is made when the customer accepts a quotation.',
                    ),
                  ];
                }
                final late = rows.where((o) => o.mn('needs')?.b('late') ?? false).length;
                return [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 4),
                    child: Text(
                      '${rows.length} ${rows.length == 1 ? 'order' : 'orders'}${late > 0 ? ', $late late' : ''}',
                      style: context.t.bodySmall!.copyWith(color: late > 0 ? context.c.bad : null, fontWeight: late > 0 ? FontWeight.w600 : null),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: Card(clipBehavior: Clip.antiAlias, child: CardList(children: [for (final o in rows) OrderRow(o, showStage: false)])),
                  ),
                ];
              },
            ),
          ],
        ),
      ),
    );
  }
}

/// One order in a list (also the dashboard's to-do): what it needs now is the headline, late in red.
class OrderRow extends StatelessWidget {
  const OrderRow(this.o, {super.key, this.showStage = true});
  final Json o;
  final bool showStage;
  @override
  Widget build(BuildContext context) {
    final needs = o.mn('needs');
    final late = needs?.b('late') ?? false;
    final cur = o.s('currency', 'USD');
    final due = f.toCents(o['due']);
    final assignee = o.m('inquiry').mn('assignee');
    final c = context.c;
    return InkWell(
      key: ValueKey('order-${o.s('id')}'),
      onTap: () => context.push('/orders/${o.s('id')}'),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Text(o.s('refNo'), style: mono13(context).copyWith(fontSize: 12, color: c.muted)),
            const Spacer(),
            if (late) ...[const ToneBadge('Late', tone: Tone.bad), gap4],
            if (showStage) orderStageBadge(o.s('stage')),
          ]),
          const SizedBox(height: 4),
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Icon(needs == null ? Icons.check_circle_outline_rounded : (late ? Icons.schedule_rounded : Icons.arrow_forward_rounded), size: 16, color: late ? c.bad : (needs == null ? c.ok : c.primary)),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                needs?.s('title') ?? (due > 0 ? '${f.cents(due, cur)} still due' : 'Paid and delivered'),
                style: context.t.bodyMedium!.copyWith(fontWeight: FontWeight.w600, color: late ? c.bad : null),
              ),
            ),
          ]),
          const SizedBox(height: 3),
          Row(children: [
            Expanded(
              child: Text(
                [
                  o.m('customer').s('name'),
                  if (needs != null) late ? 'was due ${f.shortDate(needs.s('due'))}' : 'by ${f.shortDate(needs.s('due'))}',
                ].join(' · '),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: context.t.bodySmall!.copyWith(color: late ? c.bad : null, fontWeight: late ? FontWeight.w600 : null),
              ),
            ),
            if (needs != null && due > 0) ...[gap8, Text('${f.cents(due, cur)} due', style: context.t.bodySmall!.copyWith(fontFeatures: const [FontFeature.tabularFigures()]))],
            if (assignee != null) ...[gap8, Avatar(assignee.s('name'), size: 22)],
          ]),
        ]),
      ),
    );
  }
}
